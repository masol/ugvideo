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
import type { SceneStage, StageEntity, StageWorld } from "./types.js";

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
                .describe("实体大类，只能选一个：character=人物/生物角色(含人类、拟人化生物、神话生物等有行动力的角色)；prop=可被拿起移动的道具(茶壶/武器/书本/鱼干等)；set=固定或半固定陈设(桌/椅/门/窗/地面/墙/法盆/书架等一切场景物件，家具全部选set)；light=光源"),
            appearance: z.string().nullable()
                .describe("只抄录原文对该实体的外观描写(发型发色/五官/服装材质颜色/配饰/形状磨损/材质年代)；原文没有任何外观描写则填 null，禁止自行想象"),
            humanoid: z.boolean()
                .describe("该实体外观是否具有人形特征：人类/仙人/拟人化角色/人形机器人=true；纯兽形(龙/蛇/鸟等非人形态)/纯物件=false；仅character类需认真判断，prop/set/light一律填false"),
            count: z.number().int()
                .describe("该实体代表多少个个体：明确单个=1；明确群体有数量(如'三名士兵')=具体数字；群体但数量不确定(如'众村民''一群士兵')=0；非character类一律填1"),
        })
    ).describe("原文中真实出现的所有可见实体清单，忠实抽取，不遗漏也不臆造"),
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
    }));
    return { world, entities, spatial_layout: raw.spatial_layout ?? null };
}

// ============================================================
// 代词残留检测（Pass C 用）
// ============================================================

// (?<![「\w其]) 排除：紧跟规范名标记「后、英文单词字符后，以及"其他/其它"中的"其"后。
const PRONOUN_PATTERN = /(?<![「\w其])(?:他|她|它|他们|她们|它们|此人|此物|该人|那人|那把|那个|这把|这个|对方|前者|后者)(?![」\w])/g;

// 节拍格式固定字段标记：台词字段内容从"台词："起，到下一字段标记 / 换行 / 文末为止。
const DIALOGUE_SPAN_PATTERN = /台词：[\s\S]*?(?=状态变化：|情绪：|来源群体：|动作：|\n|$)/g;

interface PronounOccurrence {
    /** 代词所在句/行的前后文片段（含代词本身） */
    context: string;
    /** 代词词 */
    pronoun: string;
    /** 在原文本中的字符偏移（用于定位） */
    offset: number;
}

/**
 * 识别被扫描文本自身中的"台词"字段区间（字符偏移，含起排除对话内代词）。
 * beat 格式固定：… 台词：<对话内容> 状态变化：… —— 台词内容天然可正则圈定。
 * 直接在被扫描文本上计算，偏移与代词检测同源，不会错位。
 */
function findDialogueSpans(text: string): Array<{ start: number; end: number }> {
    const spans: Array<{ start: number; end: number }> = [];
    for (const m of text.matchAll(DIALOGUE_SPAN_PATTERN)) {
        const start = m.index ?? 0;
        spans.push({ start, end: start + m[0].length });
    }
    return spans;
}

/**
 * 在文本中找出所有代词残留，并提取每个代词的"前后文片段"（各 40 字），
 * 但排除位于"台词"字段内的代词（对话内代词保持原样，不需消解）。
 */
function findPronounOccurrences(text: string, maxResults = 20): PronounOccurrence[] {
    if (!text) return [];

    const dialogueSpans = findDialogueSpans(text);
    const occurrences: PronounOccurrence[] = [];

    for (const match of text.matchAll(PRONOUN_PATTERN)) {
        const pronoun = match[0];
        const offset = match.index ?? 0;

        // 位于台词字段内 → 跳过（对话内代词不消解）
        const inDialogue = dialogueSpans.some(s => offset >= s.start && offset < s.end);
        if (inDialogue) continue;

        // 提取前后各 40 字的上下文片段
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
// 最终产出：名称对齐后的场景原文
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

        // 提取代词残留位置 + 上下文（自动排除台词字段内代词）
        const occurrences = findPronounOccurrences(alignedNl);

        if (occurrences.length === 0) {
            alignedText = alignedNl;
            ctx.info(`[PassC] ${sceneId} 名称对齐通过（第${attempt + 1}次）`);
            break;
        }

        ctx.info(`[PassC] ${sceneId} 第${attempt + 1}次对齐残留 ${occurrences.length} 处代词（已排除台词内）`);
        // 日志：前 3 条上下文
        for (const occ of occurrences.slice(0, 3)) {
            ctx.info(`[PassC]   "${occ.pronoun}" @ "...${occ.context}..."`);
        }

        if (attempt === MAX_ALIGN_RETRIES) {
            alignedText = alignedNl;
            ctx.warn(`[PassC] ${sceneId} 达到最大重试，仍有 ${occurrences.length} 处代词残留`);
            break;
        }

        // 构造反馈：编号列表 + 上下文片段
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

/**
 * 把代词残留列表格式化为带上下文片段的反馈 prompt。
 * 反馈结构：编号 + 代词 + 上下文片段 + 提示 LLM 用「规范名」替换。
 */
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