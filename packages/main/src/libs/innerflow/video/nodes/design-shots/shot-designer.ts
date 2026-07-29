// nodes/design-shots/shot-designer.ts
import { checkExpiry } from "$libs/blueprint/glossary/expiry.js";
import { getSmartModel } from "$libs/model/balancer/get-smart-model.js";
import { throwPrecondition } from "$libs/utils/err.js";
import type { IRunnerContext } from "$types/blueprint/context.js";
import { generateText } from "ai";
import pMap from "p-map";
import type { SceneStage, StageEntity } from "../align-entities/types.js";
import { ASSET_DESIGNER_PROMPT } from "./prompts/asset-designer.js";
import { ASSET_REVIEWER_PROMPT } from "./prompts/asset-reviewer.js";
import { INTENT_EXTRACTOR_PROMPT } from "./prompts/intent-extractor.js";
import { LIGHTING_DESIGNER_PROMPT } from "./prompts/lighting-designer.js";
import { SHOT_DESIGNER_PROMPT } from "./prompts/shot-designer.js";
import { SKILL_GENERATOR_PROMPT } from "./prompts/skill-generator.js";
import { buildStyleDirectives } from "./prompts/style-directives.js";
import { ShotStorage } from "./storage.js";
import type { EntityAsset, GlobalStyle, SceneLighting } from "./types.js";

const P = "#video:";
const MAX_REVIEW_ROUNDS = 2;
const MAX_SHOT_ENTITY_CHECK_ROUNDS = 3;

// ============================================================
// RAG 接口（留空）
// ============================================================

async function queryShotSkill(_query: string): Promise<string | null> {
    return null;
}

async function queryAssetSkill(_query: string): Promise<string | null> {
    return null;
}

// ============================================================
// 素材全局约束初始化
// ============================================================

export function initAssetConstraints(ctx: IRunnerContext): void {
    const store = new ShotStorage(ctx);

    if (store.getAssetConstraints().length > 0) {
        ctx.info("[initAssetConstraints] 素材约束已存在，跳过");
        return;
    }

    const entities = store.allGlobalEntities();
    for (const entity of entities) {
        if (entity.appearance) {
            store.upsertAssetConstraint(entity.name, entity.appearance, entity.scenes[0] ?? "unknown");
        }
    }

    ctx.info(`[initAssetConstraints] 初始化完成，${store.getAssetConstraints().length} 条`);
}

// ============================================================
// 单场景设计主入口
// ============================================================

export async function designScene(ctx: IRunnerContext, sceneId: string): Promise<void> {
    const store = new ShotStorage(ctx);

    if (!checkExpiry(ctx, {
        inputKeys: [
            `${P}output:aligned_text_${sceneId}`,
            `${P}state:stage_${sceneId}`,
            store.assetConstraintsKey(),
        ],
        outputKeys: [store.designKey(sceneId), store.lightingKey(sceneId)],
    })) {
        ctx.info(`[designScene] ${sceneId} 仍新鲜，跳过`);
        return;
    }

    const alignedText = store.getAlignedText(sceneId);
    if (!alignedText) throwPrecondition(`[designScene] ${sceneId} 缺少对齐原文`);

    const stage = store.getStage(sceneId);
    if (!stage) throwPrecondition(`[designScene] ${sceneId} 缺少舞台信息`);

    const globalStyle = store.getGlobalStyle();
    const styleDirectives = buildStyleDirectives({
        pacing: globalStyle.pacing,
        style: globalStyle.style,
        color_tone: globalStyle.color_tone,
        camera_movement: globalStyle.camera_movement,
        audience: globalStyle.audience,
        aspect_ratio: globalStyle.aspect_ratio,
    });

    // Pass A：场景意图
    const intent = await extractIntent(ctx, sceneId, alignedText, stage);
    const { intentSection, riskSection } = splitIntent(intent);
    const ragQuery = buildRagQuery(intentSection);
    const configForSkill = formatConfigForSkill(globalStyle);

    // SKILL
    const shotSkill = await ensureShotSkill(ctx, sceneId, ragQuery, intentSection, riskSection, configForSkill);
    const assetSkill = await ensureAssetSkill(ctx, sceneId, ragQuery, intentSection, riskSection, configForSkill);

    // Pass C：场景光照
    const lighting = await designLighting(ctx, sceneId, stage, intentSection, styleDirectives);
    const lightingText = formatLighting(lighting);

    // Pass B：分镜设计（含实体引用自检 ReAct）
    await designShotsForScene(ctx, sceneId, {
        alignedText, stage, styleDirectives, shotSkill, lightingText,
    });

    // Pass D：逐实体素材扩写
    await designAssetsForScene(ctx, sceneId, {
        alignedText, stage, styleDirectives, assetSkill, lightingText,
    });

    store.markSceneDesigned(sceneId);
    ctx.info(`[designScene] ${sceneId} 完成`);
}

// ============================================================
// Pass A：场景意图
// ============================================================

async function extractIntent(
    ctx: IRunnerContext,
    sceneId: string,
    alignedText: string,
    stage: SceneStage,
): Promise<string> {
    const store = new ShotStorage(ctx);

    if (!checkExpiry(ctx, {
        inputKeys: `${P}output:aligned_text_${sceneId}`,
        outputKeys: store.intentKey(sceneId),
    })) {
        const cached = store.getIntent(sceneId);
        if (cached) return cached;
    }

    const stageInfo = formatStageInfo(stage);
    const { text } = await generateText({
        model: getSmartModel(undefined, ctx),
        instructions: INTENT_EXTRACTOR_PROMPT.system,
        prompt: INTENT_EXTRACTOR_PROMPT.user(alignedText, stageInfo),
    });

    store.saveIntent(sceneId, text);
    ctx.info(`[PassA] ${sceneId} 意图抽象完成`);
    return text;
}

// ============================================================
// SKILL 获取
// ============================================================

async function ensureShotSkill(
    ctx: IRunnerContext,
    sceneId: string,
    ragQuery: string,
    intentSection: string,
    riskSection: string,
    configForSkill: string,
): Promise<string> {
    const store = new ShotStorage(ctx);

    if (!checkExpiry(ctx, {
        inputKeys: store.intentKey(sceneId),
        outputKeys: store.shotSkillKey(sceneId),
    })) {
        const cached = store.getShotSkill(sceneId);
        if (cached) return cached;
    }

    const fromRag = await queryShotSkill(ragQuery);
    if (fromRag) {
        store.saveShotSkill(sceneId, fromRag);
        return fromRag;
    }

    const { text } = await generateText({
        model: getSmartModel(undefined, ctx),
        instructions: SKILL_GENERATOR_PROMPT.shotSystem,
        prompt: SKILL_GENERATOR_PROMPT.shotUser(intentSection, riskSection, configForSkill),
    });

    store.saveShotSkill(sceneId, text);
    ctx.info(`[ShotSkill] ${sceneId} LLM 生成`);
    return text;
}

async function ensureAssetSkill(
    ctx: IRunnerContext,
    sceneId: string,
    ragQuery: string,
    intentSection: string,
    riskSection: string,
    configForSkill: string,
): Promise<string> {
    const store = new ShotStorage(ctx);

    if (!checkExpiry(ctx, {
        inputKeys: store.intentKey(sceneId),
        outputKeys: store.assetSkillKey(sceneId),
    })) {
        const cached = store.getAssetSkill(sceneId);
        if (cached) return cached;
    }

    const fromRag = await queryAssetSkill(ragQuery);
    if (fromRag) {
        store.saveAssetSkill(sceneId, fromRag);
        return fromRag;
    }

    const { text } = await generateText({
        model: getSmartModel(undefined, ctx),
        instructions: SKILL_GENERATOR_PROMPT.assetSystem,
        prompt: SKILL_GENERATOR_PROMPT.assetUser(intentSection, riskSection, configForSkill),
    });

    store.saveAssetSkill(sceneId, text);
    ctx.info(`[AssetSkill] ${sceneId} LLM 生成`);
    return text;
}

// ============================================================
// Pass C：场景光照
// ============================================================

async function designLighting(
    ctx: IRunnerContext,
    sceneId: string,
    stage: SceneStage,
    intentSection: string,
    styleDirectives: string,
): Promise<SceneLighting> {
    const store = new ShotStorage(ctx);

    if (!checkExpiry(ctx, {
        inputKeys: [`${P}state:stage_${sceneId}`, store.intentKey(sceneId)],
        outputKeys: store.lightingKey(sceneId),
    })) {
        const cached = store.getLighting(sceneId);
        if (cached) return cached;
    }

    const sceneEnv = `环境：${stage.world.environment}\n原文光线：${stage.world.key_light ?? "无"}`;
    const sceneMood = extractField(intentSection, "情绪基调") || "中性";

    const { text } = await generateText({
        model: getSmartModel(undefined, ctx),
        instructions: LIGHTING_DESIGNER_PROMPT.system(styleDirectives),
        prompt: LIGHTING_DESIGNER_PROMPT.user(sceneEnv, sceneMood),
    });

    const lighting = parseLighting(text);
    store.saveLighting(sceneId, lighting);
    ctx.info(`[PassC] ${sceneId} 光照方案完成：${lighting.summary}`);
    return lighting;
}

// ============================================================
// Pass B：分镜设计 + 实体引用自检 ReAct
// ============================================================

async function designShotsForScene(
    ctx: IRunnerContext,
    sceneId: string,
    params: {
        alignedText: string;
        stage: SceneStage;
        styleDirectives: string;
        shotSkill: string;
        lightingText: string;
    },
): Promise<void> {
    const store = new ShotStorage(ctx);

    if (!checkExpiry(ctx, {
        inputKeys: [store.shotSkillKey(sceneId), store.lightingKey(sceneId)],
        outputKeys: store.designKey(sceneId),
    })) {
        ctx.info(`[PassB] ${sceneId} 分镜仍新鲜，跳过`);
        return;
    }

    const stageInfo = formatStageInfo(params.stage);
    const entityList = params.stage.entities
        .map(e => `- 「${e.name}」`)
        .join("\n");

    // 允许引用的实体集合（用于自检）
    const allowedEntities = new Set(params.stage.entities.map(e => e.name));

    let designNl: string | null = null;
    let feedback: string | undefined;

    for (let round = 0; round <= MAX_SHOT_ENTITY_CHECK_ROUNDS; round++) {
        const promptUser = SHOT_DESIGNER_PROMPT.user({
            alignedText: params.alignedText,
            stageInfo,
            entityList,
        });

        const finalPrompt = feedback
            ? `${promptUser}\n\n【上轮检查未通过，请修正】\n${feedback}`
            : promptUser;

        const { text } = await generateText({
            model: getSmartModel(undefined, ctx),
            instructions: SHOT_DESIGNER_PROMPT.system(params.styleDirectives, params.shotSkill, params.lightingText),
            prompt: finalPrompt,
        });

        designNl = text.trim();

        // 程序化自检：提取所有「」内的实体引用
        const referencedEntities = extractEntityReferences(designNl);
        const invalidEntities = referencedEntities.filter(e => !allowedEntities.has(e));

        if (invalidEntities.length === 0) {
            ctx.info(`[PassB] ${sceneId} 分镜实体引用检查通过（第${round + 1}轮）`);
            break;
        }

        // 发现非法引用 → 构造反馈
        ctx.warn(`[PassB] ${sceneId} 分镜引用了清单外实体（第${round + 1}轮）：${invalidEntities.join("、")}`);

        if (round === MAX_SHOT_ENTITY_CHECK_ROUNDS) {
            ctx.warn(`[PassB] ${sceneId} 达到最大自检轮次，强制通过但记录问题`);
            break;
        }

        feedback = buildEntityCheckFeedback(invalidEntities, allowedEntities);
    }

    if (!designNl) {
        throwPrecondition(`[PassB] ${sceneId} 分镜产出为空`);
    }

    store.saveDesign(sceneId, designNl);
    ctx.info(`[PassB] ${sceneId} 分镜落盘 ${designNl.length}字`);
}

/**
 * 程序化自检：从分镜文本中提取所有「」内的实体名。
 * 返回去重后的实体名数组。
 */
function extractEntityReferences(text: string): string[] {
    const pattern = /「([^」]+)」/g;
    const found = new Set<string>();

    for (const match of text.matchAll(pattern)) {
        const entityName = match[1].trim();
        if (entityName) found.add(entityName);
    }

    return Array.from(found);
}

/**
 * 构造实体引用检查失败的反馈 prompt。
 */
function buildEntityCheckFeedback(invalidEntities: string[], allowedEntities: Set<string>): string {
    const lines: string[] = [
        `你的分镜文本中引用了以下清单外的实体，这是严重错误：`,
        ``,
        `非法引用：${invalidEntities.map(e => `「${e}」`).join("、")}`,
        ``,
        `本场景允许引用的实体清单如下（仅限这些）：`,
        ...Array.from(allowedEntities).map(e => `- 「${e}」`),
        ``,
        `请检查你的分镜文本，将所有非法引用替换为清单内的实体，或删除相关描述。`,
        `特别注意：不要引用原文中括号标注的别名（如"豢龙氏（长腿美女）"中的"长腿美女"若不在清单里，不得引用）。`,
    ];

    return lines.join("\n");
}

// ============================================================
// Pass D：逐实体素材扩写
// ============================================================

async function designAssetsForScene(
    ctx: IRunnerContext,
    sceneId: string,
    params: {
        alignedText: string;
        stage: SceneStage;
        styleDirectives: string;
        assetSkill: string;
        lightingText: string;
    },
): Promise<void> {
    // const store = new ShotStorage(ctx);

    const sceneContext = `环境：${params.stage.world.environment}\n开场站位：${params.stage.spatial_layout ?? "无"}\n原文节选：${params.alignedText.slice(0, 300)}`;

    await pMap(
        params.stage.entities,
        async (entity) => {
            await designSingleAsset(ctx, sceneId, entity, {
                styleDirectives: params.styleDirectives,
                assetSkill: params.assetSkill,
                lightingText: params.lightingText,
                sceneContext,
            });
        },
        { concurrency: 3 },
    );

    ctx.info(`[PassD] ${sceneId} 素材扩写完成，${params.stage.entities.length} 个实体`);
}

async function designSingleAsset(
    ctx: IRunnerContext,
    sceneId: string,
    entity: StageEntity,
    params: {
        styleDirectives: string;
        assetSkill: string;
        lightingText: string;
        sceneContext: string;
    },
): Promise<void> {
    const store = new ShotStorage(ctx);
    const existingConstraint = findConstraint(store, entity.name);
    const countLabel = entity.count === 0 ? "群体" : entity.count === 1 ? "个体" : `${entity.count}个`;

    let assetNl: string | null = null;
    let feedback: string | undefined;

    for (let round = 0; round <= MAX_REVIEW_ROUNDS; round++) {
        const { text } = await generateText({
            model: getSmartModel(undefined, ctx),
            instructions: ASSET_DESIGNER_PROMPT.system(params.styleDirectives, params.assetSkill),
            prompt: ASSET_DESIGNER_PROMPT.user({
                entityName: entity.name,
                entityKind: entity.kind,
                entityCount: countLabel,
                originalAppearance: entity.appearance ?? "无",
                existingConstraint,
                sceneLighting: params.lightingText,
                sceneContext: params.sceneContext,
                reviewFeedback: feedback,
            }),
        });
        assetNl = text;

        if (!existingConstraint) break;

        if (round < MAX_REVIEW_ROUNDS) {
            const baseDesc = extractSection(text, "基础描述");
            const verdict = await reviewAssetConflict(ctx, entity.name, existingConstraint, baseDesc);
            if (verdict.passed) break;
            feedback = verdict.issues.join("\n");
            ctx.info(`[PassD] ${sceneId}/${entity.name} 冲突：${feedback}`);
        } else {
            ctx.warn(`[PassD] ${sceneId}/${entity.name} 达到最大评审轮次，强制通过`);
        }
    }

    if (!assetNl) return;

    const asset = parseEntityAsset(entity.name, entity.kind, assetNl);
    store.saveEntityAsset(sceneId, asset);

    if (!existingConstraint && asset.base_description) {
        store.upsertAssetConstraint(entity.name, asset.base_description, sceneId);
    }
}

async function reviewAssetConflict(
    ctx: IRunnerContext,
    entityName: string,
    existingConstraint: string,
    baseDescription: string,
): Promise<{ passed: boolean; issues: string[] }> {
    const { text } = await generateText({
        model: getSmartModel(undefined, ctx),
        instructions: ASSET_REVIEWER_PROMPT.system,
        prompt: ASSET_REVIEWER_PROMPT.user({ entityName, existingConstraint, baseDescription }),
    });

    const lines = text.trim().split(/\n+/).filter(Boolean);
    const lastLine = (lines.pop() ?? "").toUpperCase();
    const passed = /\bPASS\b/.test(lastLine) && !/\bREVISE\b/.test(lastLine);

    const issues: string[] = [];
    if (!passed) {
        const resultIdx = text.indexOf("## 检查结果");
        if (resultIdx >= 0) {
            const section = text.slice(resultIdx + "## 检查结果".length).trim();
            const resultLines = section.split(/\n/).filter(Boolean);
            resultLines.pop();
            for (const line of resultLines) {
                const trimmed = line.replace(/^[-*]\s*/, "").trim();
                if (trimmed && trimmed !== "无冲突") issues.push(trimmed);
            }
        }
        if (issues.length === 0) issues.push("评审报冲突但未给出具体项");
    }

    return { passed, issues };
}

// ============================================================
// 辅助函数
// ============================================================

function splitIntent(intent: string): { intentSection: string; riskSection: string } {
    const riskMarker = "## AI 风险点";
    const idx = intent.indexOf(riskMarker);
    if (idx < 0) return { intentSection: intent.trim(), riskSection: "（无特别风险点）" };
    return { intentSection: intent.slice(0, idx).trim(), riskSection: intent.slice(idx).trim() };
}

function buildRagQuery(intentSection: string): string {
    return [
        extractField(intentSection, "核心动作"),
        extractField(intentSection, "情绪基调"),
        extractField(intentSection, "参与人数"),
        extractField(intentSection, "空间类型"),
        extractField(intentSection, "内在节奏"),
    ].filter(Boolean).join("｜");
}

function extractField(text: string, label: string): string {
    const m = text.match(new RegExp(`${label}：\\s*(.+)`));
    return m ? m[1].trim() : "";
}

function extractSection(text: string, heading: string): string {
    const re = new RegExp(`##\\s*${heading}\\s*\\n([\\s\\S]*?)(?=\\n##\\s|$)`);
    const m = text.match(re);
    return m ? m[1].trim() : "";
}

function formatConfigForSkill(style: GlobalStyle): string {
    return [
        `画幅：${style.aspect_ratio}`,
        `运镜风格：${style.camera_movement}`,
        `节奏基调：${style.pacing}`,
        `视觉风格：${style.style}`,
        `受众分级：${style.audience}`,
        `色调：${style.color_tone}`,
    ].join("\n");
}

function formatStageInfo(stage: SceneStage): string {
    const lines: string[] = [];
    lines.push(`环境：${stage.world.environment}`);
    lines.push(`光线：${stage.world.key_light ?? "无"}`);
    lines.push(`开场站位：${stage.spatial_layout ?? "无"}`);
    lines.push(`实体：`);
    for (const e of stage.entities) {
        lines.push(`  - ${e.name}（${e.kind}）外观：${e.appearance ?? "无"}`);
    }
    return lines.join("\n");
}

function findConstraint(store: ShotStorage, entityName: string): string {
    const c = store.getAssetConstraints().find(x => x.entity_name === entityName);
    return c?.visual_description ?? "";
}

function formatLighting(l: SceneLighting): string {
    return [
        `主光方向：${l.key_light_direction}`,
        `主光色温：${l.key_light_color}`,
        `补光：${l.fill_light}`,
        `环境氛围：${l.ambient}`,
        `整体效果：${l.summary}`,
    ].join("\n");
}

function parseLighting(text: string): SceneLighting {
    const pick = (label: string): string => {
        const m = text.match(new RegExp(`${label}[：:]\\s*(.+)`));
        return m ? m[1].replace(/^\[|\]$/g, "").trim() : "无";
    };
    return {
        key_light_direction: pick("主光方向"),
        key_light_color: pick("主光色温"),
        fill_light: pick("补光"),
        ambient: pick("环境氛围"),
        summary: pick("整体效果"),
    };
}

function parseEntityAsset(name: string, kind: string, text: string): EntityAsset {
    const base = extractSection(text, "基础描述");
    const delta = extractSection(text, "本场景变化");
    const light = extractSection(text, "光影效果");
    const importanceRaw = extractSection(text, "重要性").toLowerCase();
    const importance: "primary" | "secondary" =
        /primary|主要|重要/.test(importanceRaw) ? "primary" : "secondary";

    return {
        entity_name: name,
        kind,
        importance,
        base_description: base,
        scene_delta: delta === "无" ? "" : delta,
        lighting_effect: light,
    };
}