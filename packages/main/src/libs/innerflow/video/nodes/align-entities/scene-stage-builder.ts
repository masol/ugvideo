// nodes/align-entities/scene-stage-builder.ts
import { checkExpiry } from "$libs/blueprint/glossary/expiry.js";
import { getSmartModel } from "$libs/model/balancer/get-smart-model.js";
import { safefmt } from "$libs/model/llm/outline.js";
import { throwPrecondition } from "$libs/utils/err.js";
import type { IRunnerContext } from "$types/blueprint/context.js";
import { generateText, Output } from "ai";
import { z } from "zod";
import { BEAT_ANALYZER_PROMPT } from "./prompts/beat-analyzer.js";
import { ENTITY_ANALYZER_PROMPT } from "./prompts/entity-analyzer.js";
import { NAME_ALIGNER_PROMPT } from "./prompts/name-aligner.js";
import { Storage } from "./storage.js";
import type { EntityOrigin, SceneStage, StageEntity, StageWorld } from "./types.js";

// ============================================================
// safefmt Schema — 静态舞台（Pass A）
// ============================================================

const StaticStageSchema = z.object({
    world: z.object({
        environment: z.string()
            .describe("场景空间的自然语言描述，只包含原文提到或场景标头给出的地点/室内外/陈设/材质/氛围；不要自行设计原文没有的环境"),
        key_light: z.string().nullable()
            .describe("原文或场景标头明确的光线/时间线索，如'日''夜''烛光''雨天阴光'；原文完全没有光线信息则填 null，禁止推断打光方向或色温"),
    }),
    entities: z.array(
        z.object({
            name: z.string()
                .describe("实体在原文中的称呼，直接作为标识使用，禁止编号(不要 e01/e02)；同一场景出现多个同名实体时用原文可辨的定语区分，如'披甲士兵''持刀士兵'"),
            kind: z.enum(["character", "prop", "set", "light"])
                .describe("实体大类，只能选一个：character=人物/生物角色(含人类、拟人化生物、神话生物等有行动力的角色)；prop=可被拿起移动的道具(茶壶/武器/书本/鱼干等)；穿在角色身上的衣物归入角色 costume，不抽为 prop；set=固定或半固定陈设(桌/椅/门/窗/地面/墙/法盆/书架等一切场景物件，家具全部选set)；light=光源"),
            appearance: z.string().nullable()
                .describe("只抄录原文对该实体的外观描写(发型发色/五官/服装材质颜色/配饰/形状磨损/材质年代)；原文没有任何外观描写则填 null，禁止自行想象"),
            humanoid: z.boolean()
                .describe("该实体外观是否具有人形特征：人类/仙人/拟人化角色/人形机器人=true；纯兽形(龙/蛇/鸟等非人形态)/纯物件=false；仅character类需认真判断，prop/set/light一律填false"),
            count: z.number().int()
                .describe("该实体代表多少个个体：明确单个=1；明确群体有数量(如'三名士兵')=具体数字；群体但数量不确定(如'众村民''一群士兵')=0；非character类一律填1"),
            source_group: z.string().nullable()
                .describe("若该实体是从某群体中提升出的独立个体（原文中该群体成员有独立戏份），填来源群体名称（如'士兵们'）；否则填 null。有 source_group 的实体不进全局登记册，只在本场景内有独立视觉描述"),
            origin: z.string().nullable()
                .describe("出生方式，仅 prop/set 需要填写，character/light 填 null。值为以下之一：'scene'=场景固有（开场即存在于空间中的物件）；'character:角色名'=由该角色带入/持有/掏出/催生的道具。原文没说且无法判断时填'scene'（宁可归入场景）"),
            worn_by: z.string().nullable()
                .describe("仅 prop 字段填写，character/set/light 一律填 null。若该道具是穿在某角色身上/角色正在穿戴的衣物或配饰（原文描述为'穿/戴/披/系/佩'在某角色身上，或为'该角色身上的某个部分'），填该角色的原文称呼。下游会把该 prop 从 prop 集合剔除，并将其外观特征作为 scene_delta 合并到该角色本场景描述中，避免与 costume 重复。独立可手持的道具填 null"),
        })
    ).describe("原文中真实出现的所有可见实体清单，忠实抽取，不遗漏也不臆造；群体中有独立戏份的成员须单独建条目并标注 source_group；prop/set 必须标注 origin；穿在角色身上的衣物/配饰必须标注 worn_by 以避免与定妆照重复"),
    spatial_layout: z.string().nullable()
        .describe("开场瞬间所有实体相对位置与姿态的自然语言整体描述，仅基于原文可支撑的信息(谁在谁左右/前后/上下，谁跪谁站，谁持有什么及哪只手，谁盘绕/倚靠/包围谁)；可自由使用任意方位词；原文完全没有空间信息则填 null"),
});

type RawStaticStage = z.infer<typeof StaticStageSchema>;

// ============================================================
// 内部工具
// ============================================================

function buildRoster(entities: Array<{ name: string; kind: string; count: number }>): string {
    return entities.map(e => {
        const countLabel = e.count === 0 ? "群体" : e.count === 1 ? "个体" : `${e.count}个`;
        return `${e.name}｜${e.kind}｜${countLabel}`;
    }).join("\n");
}

/** 解析 origin 字符串为 EntityOrigin 类型 */
function parseOrigin(raw: string | null, kind: string): EntityOrigin {
    if (kind === "character" || kind === "light") return "scene";
    if (!raw) return "scene";
    if (raw === "scene" || raw === "场景固有") return "scene";
    // "character:角色名" 或 "持有者：角色名"
    const charMatch = raw.match(/^(?:character:|持有者[：:]\s*)(.+)/);
    if (charMatch) return `character:${charMatch[1].trim()}`;
    return "scene";
}

/** RawStaticStage → SceneStage */
function toSceneStage(raw: RawStaticStage, sceneId: string): SceneStage {
    const world: StageWorld = {
        scene_id: sceneId,
        environment: raw.world.environment,
        key_light: raw.world.key_light ?? null,
    };
    const entities: StageEntity[] = raw.entities.map(e => ({
        name: e.name,
        kind: e.kind,
        appearance: e.appearance ?? null,
        humanoid: e.humanoid ?? false,
        count: e.count ?? 1,
        source_group: e.source_group ?? null,
        origin: parseOrigin(e.origin, e.kind),
        worn_by: e.worn_by ?? null,
    }));
    return { world, entities, spatial_layout: raw.spatial_layout ?? null };
}

// ============================================================
// 代词残留检测（Pass C 用）
// ============================================================

const PRONOUN_PATTERN = /(?<![「\w其])(?:他|她|它|他们|她们|它们|此人|此物|该人|那人|那把|那个|这把|这个|对方|前者|后者)(?![」\w])/g;

const DIALOGUE_SPAN_PATTERN = /台词：[\s\S]*?(?=状态变化：|情绪：|来源群体：|动作：|\n|$)/g;

interface PronounOccurrence {
    context: string;
    pronoun: string;
    offset: number;
}

function findDialogueSpans(text: string): Array<{ start: number; end: number }> {
    const spans: Array<{ start: number; end: number }> = [];
    for (const m of text.matchAll(DIALOGUE_SPAN_PATTERN)) {
        const start = m.index ?? 0;
        spans.push({ start, end: start + m[0].length });
    }
    return spans;
}

function findPronounOccurrences(text: string, maxResults = 20): PronounOccurrence[] {
    if (!text) return [];

    const dialogueSpans = findDialogueSpans(text);
    const occurrences: PronounOccurrence[] = [];

    for (const match of text.matchAll(PRONOUN_PATTERN)) {
        const pronoun = match[0];
        const offset = match.index ?? 0;

        const inDialogue = dialogueSpans.some(s => offset >= s.start && offset < s.end);
        if (inDialogue) continue;

        const ctxStart = Math.max(0, offset - 40);
        const ctxEnd = Math.min(text.length, offset + pronoun.length + 40);
        const ctxFragment = text.slice(ctxStart, ctxEnd)
            .replace(/\s+/g, " ")
            .trim();

        occurrences.push({
            context: ctxFragment,
            pronoun,
            offset,
        });

        if (occurrences.length >= maxResults) break;
    }

    return occurrences;
}

// ============================================================
// Pass C：名称对齐 + 代词消解（ReAct 闭环）
// ============================================================

const MAX_ALIGN_RETRIES = 3;

async function runPassC(
    ctx: IRunnerContext,
    sceneId: string,
    stage: SceneStage,
    sceneText: string,
): Promise<string> {
    const store = new Storage(ctx);

    if (!checkExpiry(ctx, {
        inputKeys: store.beatNlKey(sceneId),
        outputKeys: store.alignedTextKey(sceneId),
    })) {
        ctx.info(`[PassC] ${sceneId} 对齐缓存仍新鲜，跳过`);
        const cached = store.getAlignedText(sceneId);
        if (cached) return cached;
    }

    const roster = buildRoster(stage.entities.map(e => ({ name: e.name, kind: e.kind, count: e.count })));
    const beatNl = store.getBeatNl(sceneId);
    if (!beatNl) throwPrecondition(`[PassC] ${sceneId} 缺少 beat NL`);

    let currentInput = beatNl;
    let alignedText: string | null = null;

    for (let attempt = 0; attempt <= MAX_ALIGN_RETRIES; attempt++) {
        const feedbackSection = attempt === 0
            ? ""
            : `\n\n【上次对齐未通过，以下代词未消解，请逐条处理后输出完整对齐文本】\n${currentInput}`;

        const { text: alignedNl } = await generateText({
            model: getSmartModel(undefined, ctx),
            instructions: NAME_ALIGNER_PROMPT.system,
            prompt: NAME_ALIGNER_PROMPT.user(roster, currentInput) + feedbackSection,
        });

        const occurrences = findPronounOccurrences(alignedNl);

        if (occurrences.length === 0) {
            alignedText = alignedNl;
            ctx.info(`[PassC] ${sceneId} 名称对齐通过（第${attempt + 1}次）`);
            break;
        }

        ctx.info(`[PassC] ${sceneId} 第${attempt + 1}次对齐残留 ${occurrences.length} 处代词（已排除台词内）`);
        for (const occ of occurrences.slice(0, 3)) {
            ctx.info(`[PassC]   "${occ.pronoun}" @ "...${occ.context}..."`);
        }

        if (attempt === MAX_ALIGN_RETRIES) {
            alignedText = alignedNl;
            ctx.warn(`[PassC] ${sceneId} 达到最大重试，仍有 ${occurrences.length} 处代词残留`);
            break;
        }

        const feedback = formatPronounFeedback(occurrences, alignedNl);
        currentInput = feedback;
    }

    if (!alignedText) {
        ctx.warn(`[PassC] ${sceneId} 对齐全部失败，降级使用原文`);
        alignedText = sceneText;
    }

    store.saveAlignedText(sceneId, alignedText);
    ctx.info(`[PassC] ${sceneId} 对齐文本落盘，${alignedText.length} 字`);
    return alignedText;
}

function formatPronounFeedback(occurrences: PronounOccurrence[], originalNl: string): string {
    const lines: string[] = [
        `你的上一次输出中仍有以下代词未被消解（这些代词均不在"台词："字段内）。`,
        `请逐条处理，把每个代词替换为实体清单中的规范名，并用「」括住。`,
        `注意："台词："字段内的代词已自动忽略，请勿改动台词。`,
        `处理后请输出完整的对齐文本（不要只输出修改片段）。`,
        ``,
        `## 待处理代词（共 ${occurrences.length} 处）`,
    ];

    occurrences.forEach((occ, idx) => {
        lines.push(`${idx + 1}. 代词："${occ.pronoun}"`);
        lines.push(`   上下文：...${occ.context}...`);
        lines.push(``);
    });

    lines.push(`## 你上一次的完整输出（请基于此修改）`);
    lines.push(originalNl);

    return lines.join("\n");
}

// ============================================================
// Pass A：静态舞台
// ============================================================

async function runPassA(
    ctx: IRunnerContext,
    sceneId: string,
    sceneMeta: string,
    sceneText: string,
): Promise<SceneStage> {
    const store = new Storage(ctx);

    if (!checkExpiry(ctx, {
        inputKeys: store.sceneInputKey(sceneId),
        outputKeys: store.stageNlKey(sceneId),
    })) {
        ctx.info(`[PassA] ${sceneId} NL草稿仍新鲜，跳过生成`);
    } else {
        const { text } = await generateText({
            model: getSmartModel(undefined, ctx),
            instructions: ENTITY_ANALYZER_PROMPT.system,
            prompt: ENTITY_ANALYZER_PROMPT.user(sceneMeta, sceneText),
        });
        store.saveStageNl(sceneId, text);
        ctx.info(`[PassA] ${sceneId} NL草稿完成 ${text.length}字`);
    }

    if (!checkExpiry(ctx, {
        inputKeys: store.stageNlKey(sceneId),
        outputKeys: store.stageKey(sceneId),
    })) {
        ctx.info(`[PassA] ${sceneId} 结构化缓存仍新鲜，跳过提取`);
        const cached = store.getStage(sceneId);
        if (cached) return cached;
    }

    const nl = store.getStageNl(sceneId);
    if (!nl) throwPrecondition(`[PassA] ${sceneId} 缺少NL草稿`);

    const result = await safefmt(
        nl,
        Output.object({ schema: StaticStageSchema }),
        ctx,
    );

    if (!result.success || !result.value) {
        throwPrecondition(`[PassA] ${sceneId} 静态舞台抽取失败`);
    }

    const stage = toSceneStage(result.value.output, sceneId);
    store.saveStage(sceneId, stage);
    ctx.info(`[PassA] ${sceneId} 抽取完成，实体数=${stage.entities.length}`);
    return stage;
}

// ============================================================
// Pass B：节拍时间线 NL（仅产 NL，不做 safefmt 提取）
// ============================================================

async function runPassB(
    ctx: IRunnerContext,
    sceneId: string,
    stage: SceneStage,
    sceneText: string,
): Promise<void> {
    const store = new Storage(ctx);
    const roster = buildRoster(stage.entities.map(e => ({ name: e.name, kind: e.kind, count: e.count })));

    if (!checkExpiry(ctx, {
        inputKeys: store.stageKey(sceneId),
        outputKeys: store.beatNlKey(sceneId),
    })) {
        ctx.info(`[PassB] ${sceneId} beat NL仍新鲜，跳过`);
        return;
    }

    const stageSummary = [
        `环境：${stage.world.environment}`,
        `光线：${stage.world.key_light ?? "无"}`,
        `开场站位：${stage.spatial_layout ?? "无"}`,
    ].join("\n");

    const { text } = await generateText({
        model: getSmartModel(undefined, ctx),
        instructions: BEAT_ANALYZER_PROMPT.system(roster),
        prompt: BEAT_ANALYZER_PROMPT.user(stageSummary, sceneText),
    });
    store.saveBeatNl(sceneId, text);
    ctx.info(`[PassB] ${sceneId} beat NL完成 ${text.length}字`);
}

// ============================================================
// 对外入口
// ============================================================

export async function buildSceneStage(
    ctx: IRunnerContext,
    sceneId: string,
): Promise<void> {
    const store = new Storage(ctx);

    const sceneMeta = store.getSceneMeta(sceneId);
    const sceneText = store.getSceneText(sceneId);

    if (!sceneText) throwPrecondition(`[buildSceneStage] ${sceneId} 缺少场景原文`);

    const stage = await runPassA(ctx, sceneId, sceneMeta ?? "", sceneText);
    await runPassB(ctx, sceneId, stage, sceneText);
    await runPassC(ctx, sceneId, stage, sceneText);

    ctx.info(`[buildSceneStage] ${sceneId} 三Pass完成`);
}