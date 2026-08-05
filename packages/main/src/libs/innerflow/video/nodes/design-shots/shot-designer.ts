// nodes/design-shots/shot-designer.ts
import { checkExpiry } from "$libs/blueprint/glossary/expiry.js";
import { getSmartModel } from "$libs/model/balancer/get-smart-model.js";
import { configService } from "$libs/store/index.js";
import { throwPrecondition } from "$libs/utils/err.js";
import type { IRunnerContext } from "$types/blueprint/context.js";
import { generateText } from "ai";
import pMap from "p-map";
import type { SceneStage, StageEntity } from "../align-entities/types.js";
import { ASSET_DESIGNER_PROMPT } from "./prompts/asset-designer.js";
import { ASSET_REVIEWER_PROMPT } from "./prompts/asset-reviewer.js";
import { getAssetSkill, pickAssetSkill } from "./prompts/asset-skills.js";
import { INTENT_EXTRACTOR_PROMPT } from "./prompts/intent-extractor.js";
import { LIGHTING_DESIGNER_PROMPT } from "./prompts/lighting-designer.js";
import { SHOT_DESIGNER_PROMPT } from "./prompts/shot-designer.js";
import { getShotSkill, SHOT_SKILLS, type ShotSkillKind } from "./prompts/shot-skills.js";
import { buildStyleDirectives } from "./prompts/style-directives.js";
import { ShotStorage } from "./storage.js";
import type { EntityAsset, SceneLighting } from "./types.js";

const P = "#video:";
const MAX_REVIEW_ROUNDS = 2;
const MAX_SHOT_ENTITY_CHECK_ROUNDS = 3;

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

export async function designScene(ctx: IRunnerContext, sceneId: string): Promise<void> {
    const store = new ShotStorage(ctx);

    // 注意：绝不把 asset_constraints 列为 gate input。
    // asset_constraints 在本节点的素材扩写阶段被 upsertAssetConstraint 反向写脏，
    // 其时间戳必然晚于本 gate 的 output（design/lighting），一旦作为 input 会导致
    // 「input 永远比 output 新」→ gate 永远过期 → 每次重跑都触发 LLM。
    // 上游真实变更（剧本/aligned_text/stage/config）已通过 intent/lighting/design 链式 gate 传导。
    //
    // 修复：补齐 stage 作为 gate input —— intent/lighting/design 都依赖 stage，
    // 但原 gate 只引用 aligned_text/registry/align/config，stage 变化时不会触发这些 LLM 节点。
    if (!checkExpiry(ctx, {
        inputKeys: [
            `${P}output:aligned_text_${sceneId}`,
            `${P}state:stage_${sceneId}`,
            `${P}stage:registry:idx`,
            `${P}stage:align:${sceneId}`,
            `${P}shots:intent_${sceneId}`,
            "config:pace",
            "config:aspectRatio",
            "config:style",
            "config:audience",
            "config:colorTone",
            "config:cameraMovement",
        ],
        outputKeys: [store.designKey(sceneId), store.lightingKey(sceneId)],
    })) {
        ctx.info(`[designScene] ${sceneId} 仍新鲜，跳过`);
        return;
    }

    const alignedText = store.getAlignedText(sceneId);
    if (!alignedText) {
        throwPrecondition("无法获取指代消解完毕的文本。");
    }
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

    const timelineContext = buildTimelineContext(ctx, sceneId, store);

    const intent = await extractIntent(ctx, sceneId, alignedText, stage);
    const { intentSection } = splitIntent(intent);

    const shotSkillKind = pickShotSkillKind(intentSection, globalStyle.pacing);
    const shotSkill = getShotSkill(shotSkillKind);
    ctx.info(`[designScene] ${sceneId} 分镜 SKILL=${shotSkillKind}`);

    const lighting = await designLighting(ctx, sceneId, stage, intentSection, styleDirectives);
    const lightingText = formatLighting(lighting);

    await designShotsForScene(ctx, sceneId, {
        alignedText, stage, styleDirectives, shotSkill, lightingText,
    });

    await designAssetsForScene(ctx, sceneId, {
        alignedText, stage, styleDirectives, lightingText, timelineContext,
    });

    store.markSceneDesigned(sceneId);
    ctx.info(`[designScene] ${sceneId} 完成`);
}

function pickShotSkillKind(intentSection: string, pacing: string): ShotSkillKind {
    const coreAction = extractField(intentSection, "核心动作");
    const participants = extractField(intentSection, "参与人数");
    const rhythm = extractField(intentSection, "内在节奏");

    const actionLow = (coreAction + " " + intentSection).toLowerCase();

    if (/回忆|梦境|心理|内心|独白|回想|记忆/.test(actionLow)) return "psychological_abstract";
    if (/仪式|祭祀|典礼|朝拜|加冕|祈祷/.test(actionLow)) return "ceremonial_slow";
    if (/移动|奔跑|追逐|飞行|车|船|骑马|赶路|逃|追/.test(actionLow)) return "motion_continuous";
    if (/打|斗|战|搏|厮杀|冲突|攻|防/.test(actionLow)) return "action_fast";
    if (/群体|多人|会议|宴会|聚|围观/.test(participants) || /3\+|群体/.test(participants)) return "ensemble_wide";
    if (rhythm === "快" || pacing === "fast") return "dialogue_fast";
    if (rhythm === "慢" || pacing === "slow") return "dialogue_slow";
    return "default_normal";
}

function buildTimelineContext(
    _ctx: IRunnerContext,
    sceneId: string,
    store: ShotStorage,
): string {
    const meta = store.getSceneMeta(sceneId);
    if (!meta) return "";

    const ctxData = meta.context as Record<string, unknown> | undefined;
    const parts: string[] = [];

    if (ctxData?.episode) parts.push(`集：${ctxData.episode}`);
    if (ctxData?.act) parts.push(`幕：${ctxData.act}`);
    if (ctxData?.location) parts.push(`地点：${ctxData.location}`);
    if (ctxData?.timeOfDay) parts.push(`时间：${ctxData.timeOfDay}`);
    if (typeof ctxData?.first_line_summary === "string") parts.push(`摘要：${ctxData.first_line_summary}`);

    const allSceneIds = store.sceneIds();
    const sceneTimeline: string[] = [];
    for (const sid of allSceneIds) {
        const sm = store.getSceneMeta(sid);
        if (!sm) continue;
        const sc = sm.context as Record<string, unknown> | undefined;
        const label = `场景 ${sid}`;
        const ep = sc?.episode ? `${sc.episode}` : "";
        const loc = sc?.location ? `${sc.location}` : "";
        const summary = typeof sc?.first_line_summary === "string" ? sc.first_line_summary : "";
        sceneTimeline.push(`- ${label} ${ep} ${loc}：${summary}`);
    }

    let result = "";
    if (parts.length) result += `【本场景】\n${parts.join("\n")}\n\n`;
    if (sceneTimeline.length) result += `【全剧场景时间线】\n${sceneTimeline.join("\n")}`;
    return result;
}

async function extractIntent(
    ctx: IRunnerContext,
    sceneId: string,
    alignedText: string,
    stage: SceneStage,
): Promise<string> {
    const store = new ShotStorage(ctx);

    // 修复：补齐 stage 作为 gate input。intent 抽取依赖 stage 的实体清单与开场站位。
    if (!checkExpiry(ctx, {
        inputKeys: [
            `${P}output:aligned_text_${sceneId}`,
            `${P}state:stage_${sceneId}`,
        ],
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

    // 修复：补齐 stage + aligned_text 作为 gate input。
    // 分镜设计直接基于这些文本/舞台信息，原 gate 只引 intent + lighting 不够。
    if (!checkExpiry(ctx, {
        inputKeys: [
            store.intentKey(sceneId),
            store.lightingKey(sceneId),
            `${P}state:stage_${sceneId}`,
            `${P}output:aligned_text_${sceneId}`,
        ],
        outputKeys: store.designKey(sceneId),
    })) {
        ctx.info(`[PassB] ${sceneId} 分镜仍新鲜，跳过`);
        return;
    }

    const stageInfo = formatStageInfo(params.stage);
    const entityList = params.stage.entities.map(e => `- 「${e.name}」`).join("\n");

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

        const referencedEntities = extractEntityReferences(designNl);
        const invalidEntities = referencedEntities.filter(e => !allowedEntities.has(e));

        if (invalidEntities.length === 0) {
            ctx.info(`[PassB] ${sceneId} 分镜实体引用检查通过（第${round + 1}轮）`);
            break;
        }

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

function extractEntityReferences(text: string): string[] {
    const pattern = /「([^」]+)」/g;
    const found = new Set<string>();
    for (const match of text.matchAll(pattern)) {
        const entityName = match[1].trim();
        if (entityName) found.add(entityName);
    }
    return Array.from(found);
}

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
    ];
    return lines.join("\n");
}

async function designAssetsForScene(
    ctx: IRunnerContext,
    sceneId: string,
    params: {
        alignedText: string;
        stage: SceneStage;
        styleDirectives: string;
        lightingText: string;
        timelineContext: string;
    },
): Promise<void> {
    const store = new ShotStorage(ctx);

    // Pass D gate：本场景所有实体的素材描述作为 output。
    // 没有这个 gate 时，即使上游分镜/光照/意图都新鲜，Pass D 也会无脑重跑所有实体的 LLM 调用。
    const assetOutputKeys = params.stage.entities.map(e => {
        const globalName = store.resolveToGlobalName(sceneId, e.name);
        return store.entityAssetKey(sceneId, globalName);
    });

    // 注意：这里绝不能把 asset_constraints 当 input。
    // asset_constraints 会在本函数内（designSingleAsset → upsertAssetConstraint）被写脏，
    // 一旦作为自己的 input，就形成「input 永远比 output 新」的自引用，导致每次重跑都触发 LLM。
    // 上游变更（aligned_text/stage → intent → lighting → design）已通过下列链式 gate 传导，覆盖充分。
    //
    // 修复：补齐 stage + aligned_text 作为 gate input，确保上游重算时 Pass D 跟着重算。
    if (!checkExpiry(ctx, {
        inputKeys: [
            store.lightingKey(sceneId),
            store.designKey(sceneId),
            store.intentKey(sceneId),
            `${P}state:stage_${sceneId}`,
            `${P}output:aligned_text_${sceneId}`,
        ],
        outputKeys: assetOutputKeys,
    })) {
        ctx.info(`[PassD] ${sceneId} 素材扩写仍新鲜，跳过`);
        return;
    }

    const sceneContext = `环境：${params.stage.world.environment}\n开场站位：${params.stage.spatial_layout ?? "无"}\n原文节选：${params.alignedText.slice(0, 300)}`;

    await pMap(
        params.stage.entities,
        async (entity) => {
            const globalName = store.resolveToGlobalName(sceneId, entity.name);

            // 按 (sceneId, entityName) 查决策
            const decision = store.getRenderDecision(sceneId, globalName);
            if (decision?.strategy === "skip") return;

            const assetSkill = getAssetSkill(pickAssetSkill(entity.kind, entity.humanoid));

            await designSingleAsset(ctx, sceneId, entity, globalName, {
                styleDirectives: params.styleDirectives,
                assetSkill,
                lightingText: params.lightingText,
                sceneContext,
                timelineContext: params.timelineContext,
            });
        },
        { concurrency: configService().get("concurrency") },
    );

    ctx.info(`[PassD] ${sceneId} 素材扩写完成，${params.stage.entities.length} 个实体`);
}

async function designSingleAsset(
    ctx: IRunnerContext,
    sceneId: string,
    entity: StageEntity,
    globalName: string,
    params: {
        styleDirectives: string;
        assetSkill: string;
        lightingText: string;
        sceneContext: string;
        timelineContext: string;
    },
): Promise<void> {
    const store = new ShotStorage(ctx);
    const existingConstraint = findConstraint(store, globalName);
    const countLabel = entity.count === 0 ? "群体" : entity.count === 1 ? "个体" : `${entity.count}个`;

    const identity = store.getIdentity(globalName);
    const identityInfo = identity
        ? [
            `身份：${identity.identity}`,
            `族裔：${identity.ethnicity}`,
            `年龄段：${identity.age_stage}`,
            `性别：${identity.gender}`,
            `体型：${identity.body_type}`,
        ].join("\n")
        : "";

    // 关键：按 (sceneId, entityName) 读本场景的 costume
    const costume = store.getCostume(globalName, sceneId) ?? store.getFirstCostume(globalName);
    const costumeInfo = costume
        ? [
            costume.description,
            ...costume.items.map(it => `- ${it.item}：${it.material}，${it.color}`),
        ].join("\n")
        : "";

    // 按 (sceneId, entityName) 查决策
    const decision = store.getRenderDecision(sceneId, globalName);
    const renderStrategy = decision?.strategy ?? "prompt_only";

    let assetNl: string | null = null;
    let feedback: string | undefined;

    for (let round = 0; round <= MAX_REVIEW_ROUNDS; round++) {
        const reviewFeedbackWithConstraint = feedback
            ? `${feedback}\n\n【必须严格保留的约束原文（来自首次出场的基准描述，不可修改）】\n${existingConstraint}`
            : undefined;

        const { text } = await generateText({
            model: getSmartModel(undefined, ctx),
            instructions: ASSET_DESIGNER_PROMPT.system(params.styleDirectives, params.assetSkill),
            prompt: ASSET_DESIGNER_PROMPT.user({
                entityName: globalName,
                entityKind: entity.kind,
                entityCount: countLabel,
                originalAppearance: entity.appearance ?? "无",
                identityInfo,
                costumeInfo,
                renderStrategy,
                sceneLighting: params.lightingText,
                sceneContext: params.sceneContext,
                reviewFeedback: reviewFeedbackWithConstraint,
            }),
        });
        assetNl = text;

        if (!existingConstraint) break;

        if (round < MAX_REVIEW_ROUNDS) {
            const baseDesc = extractSection(text, "基础描述");
            const verdict = await reviewAssetConflict(ctx, globalName, existingConstraint, baseDesc);
            if (verdict.passed) break;
            feedback = verdict.feedback;
            ctx.info(`[PassD] ${sceneId}/${globalName} 冲突：${feedback}`);
        } else {
            ctx.warn(`[PassD] ${sceneId}/${globalName} 达到最大评审轮次，强制通过`);
        }
    }

    if (!assetNl) return;

    const asset = parseEntityAsset(globalName, entity.kind, sceneId, assetNl);
    if (decision) {
        asset.importance = decision.strategy === "individual_refsheet" ? "primary" : "secondary";
    }
    store.saveEntityAsset({ ...asset, scene_id: sceneId, entity_name: globalName });

    if (!existingConstraint && asset.base_description) {
        store.upsertAssetConstraint(globalName, asset.base_description, sceneId);
    }
}

async function reviewAssetConflict(
    ctx: IRunnerContext,
    entityName: string,
    existingConstraint: string,
    baseDescription: string,
): Promise<{ passed: boolean; feedback: string }> {
    const { text } = await generateText({
        model: getSmartModel(undefined, ctx),
        instructions: ASSET_REVIEWER_PROMPT.system,
        prompt: ASSET_REVIEWER_PROMPT.user({ entityName, existingConstraint, baseDescription }),
    });

    const trimmed = text.trim();
    const lastLine = trimmed.split(/\n+/).filter(Boolean).pop() ?? "";
    const lastUpper = lastLine.toUpperCase();
    const passed = /\bPASS\b/.test(lastUpper) && !/\bREVISE\b/.test(lastUpper);

    if (passed) return { passed: true, feedback: "" };

    const conflictItems: string[] = [];
    const sectionMatch = trimmed.match(/##\s*冲突项\s*\n([\s\S]*?)(?=\n##|\n*$)/);
    if (sectionMatch) {
        const lines = sectionMatch[1].split("\n");
        for (const line of lines) {
            const m = line.match(/^\s*\d+\.\s*(.+)/);
            if (m) conflictItems.push(m[1].trim());
        }
    }

    const feedback = conflictItems.length > 0
        ? `以下是与约束的硬冲突（仅限物种/性别/年龄段/骨骼结构/五官硬性特征）：\n${conflictItems.map((c, i) => `${i + 1}. ${c}`).join("\n")}`
        : `评审检测到冲突但未给出具体项。请确保基础描述中物种、性别、年龄段、骨骼结构、五官硬性特征与约束完全一致。`;

    return { passed: false, feedback };
}

function splitIntent(intent: string): { intentSection: string; riskSection: string } {
    const riskMarker = "## AI 风险点";
    const idx = intent.indexOf(riskMarker);
    if (idx < 0) return { intentSection: intent.trim(), riskSection: "（无特别风险点）" };
    return { intentSection: intent.slice(0, idx).trim(), riskSection: intent.slice(idx).trim() };
}

function extractField(text: string, label: string): string {
    const m = text.match(new RegExp(`${label}[：:]\\s*(.+)`));
    return m ? m[1].trim() : "";
}

function extractSection(text: string, heading: string): string {
    const re = new RegExp(`##\\s*${heading}\\s*\\n([\\s\\S]*?)(?=\\n##\\s|$)`);
    const m = text.match(re);
    return m ? m[1].trim() : "";
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

/**
 * 解析实体素材 LLM 输出（场景隔离版本）。
 */
function parseEntityAsset(name: string, kind: string, sceneId: string, text: string): EntityAsset {
    const base = extractSection(text, "基础描述");
    const delta = extractSection(text, "本场景变化");
    const light = extractSection(text, "光影效果");
    const importanceRaw = extractSection(text, "重要性").toLowerCase();
    const importance: "primary" | "secondary" =
        /primary|主要|重要/.test(importanceRaw) ? "primary" : "secondary";

    return {
        entity_name: name,
        scene_id: sceneId,
        kind,
        importance,
        base_description: base,
        scene_delta: delta === "无" ? "" : delta,
        lighting_effect: light,
        age_progression: "none",
    };
}

export { SHOT_SKILLS };
