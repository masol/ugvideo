// nodes/build-stage/scene-stage-builder.ts
import { checkExpiry } from "$libs/blueprint/glossary/expiry.js";
import { getSmartModel } from "$libs/model/balancer/get-smart-model.js";
import { safefmt } from "$libs/model/llm/outline.js";
import { throwPrecondition } from "$libs/utils/err.js";
import type { IRunnerContext } from "$types/blueprint/context.js";
import { generateText, Output } from "ai";
import { z } from "zod";
import { BEAT_ANALYZER_PROMPT } from "./prompts/beat-analyzer.js";
import { ENTITY_ANALYZER_PROMPT } from "./prompts/entity-analyzer.js";
import { Storage } from "./storage.js";
import type { Beat, BeatDelta, SceneStage, StageEntity, StageWorld } from "./types.js";

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
                .describe("实体大类，只能选一个：character=人物角色；prop=可被拿起移动的道具(茶壶/武器/书本/鱼干等)；set=固定或半固定陈设(桌/椅/门/窗/地面/墙/法盆/书架等一切场景物件，家具全部选set)；light=光源"),
            appearance: z.string().nullable()
                .describe("只抄录原文对该实体的外观描写(发型发色/五官/服装材质颜色/配饰/形状磨损/材质年代)；原文没有任何外观描写则填 null，禁止自行想象"),
        })
    ).describe("原文中真实出现的所有可见实体清单，忠实抽取，不遗漏也不臆造"),
    spatial_layout: z.string().nullable()
        .describe("开场瞬间所有实体相对位置与姿态的自然语言整体描述，仅基于原文可支撑的信息(谁在谁左右/前后/上下，谁跪谁站，谁持有什么及哪只手，谁盘绕/倚靠/包围谁)；可自由使用任意方位词；原文完全没有空间信息则填 null"),
});

type RawStaticStage = z.infer<typeof StaticStageSchema>;

// ============================================================
// safefmt Schema — 节拍时间线（Pass B）
// ============================================================

const BeatDeltaSchema = z.object({
    entity: z.string()
        .describe("发生变化的实体名称，必须是本场景实体清单中已列出的名称，不要新造"),
    action: z.string().nullable()
        .describe("本拍该实体视觉可见的行为(原文所述)，如'双膝触地行大礼'；纯心理活动不写；本拍无动作则填 null"),
    dialogue: z.string().nullable()
        .describe("本拍该实体的台词原文引用；无台词则填 null"),
    state_change: z.string().nullable()
        .describe("本拍该实体外观/状态增量(原文所述)，如'嘴角溢出血水''衣袖撕裂'；无变化则填 null"),
    emotion: z.string().nullable()
        .describe("本拍该实体从原文语气可读出的情绪，如'卑微绝望''狂热贪婪'，供TTS语气参考；读不出则填 null，不要过度演绎"),
});

const BeatSchema = z.object({
    index: z.number().int()
        .describe("节拍序号，从 1 开始，连续递增"),
    duration_hint: z.string().nullable()
        .describe("原文可推断的粗略语义时长，如'约3秒''约5秒'；无法判断则填 null"),
    summary: z.string()
        .describe("本拍核心事件一句话概括，忠实原文，包含主要动作主体与结果"),
    mood: z.string().nullable()
        .describe("本拍整体情绪基调(从原文语气读出)，如'压抑转神圣'；读不出则填 null"),
    staging: z.string().nullable()
        .describe("本拍站位/空间关系变化的自然语言描述(移动/持有变化/位置改变)，仅原文支撑，可自由使用任意方位词(盘绕/跪于/倚靠/持于左手等)；本拍无位置变化则填 null"),
    deltas: z.array(BeatDeltaSchema)
        .describe("本拍有动静的实体列表；本拍无动静的实体不列出"),
});

const BeatsSchema = z.object({
    beats: z.array(BeatSchema)
        .describe("按剧本时间顺序排列的完整节拍序列，忠实抽取，不遗漏任何时间切片"),
});

type RawBeats = z.infer<typeof BeatsSchema>;

// ============================================================
// 内部工具
// ============================================================

/** 把实体清单压成 roster（名称+类别），给 Pass B 复用 */
function buildRoster(entities: Array<{ name: string; kind: string }>): string {
    return entities.map(e => `${e.name}｜${e.kind}`).join("\n");
}

/** RawStaticStage → SceneStage（类型映射，null 透传） */
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
    }));
    return { world, entities, spatial_layout: raw.spatial_layout ?? null };
}

/** RawBeats → Beat[]（类型映射，null 透传） */
function toBeats(raw: RawBeats): Beat[] {
    return raw.beats.map(b => ({
        index: b.index,
        duration_hint: b.duration_hint ?? null,
        summary: b.summary,
        mood: b.mood ?? null,
        staging: b.staging ?? null,
        deltas: (b.deltas ?? []).map((d): BeatDelta => ({
            entity: d.entity,
            action: d.action ?? null,
            dialogue: d.dialogue ?? null,
            state_change: d.state_change ?? null,
            emotion: d.emotion ?? null,
        })),
    }));
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

    // 门控：Pass A NL 草稿
    if (!checkExpiry(ctx, {
        inputKeys: store.sceneInputKey(sceneId),
        outputKeys: store.stageNlKey(sceneId),
    })) {
        ctx.info(`[buildSceneStage:PassA] ${sceneId} NL草稿仍新鲜，跳过生成`);
    } else {
        const { text } = await generateText({
            model: getSmartModel(undefined, ctx),
            system: ENTITY_ANALYZER_PROMPT.system,
            prompt: ENTITY_ANALYZER_PROMPT.user(sceneMeta, sceneText),
        });
        store.saveStageNl(sceneId, text);
        ctx.info(`[buildSceneStage:PassA] ${sceneId} NL草稿完成 ${text.length}字`);
    }

    // 门控：Pass A safefmt 提取
    if (!checkExpiry(ctx, {
        inputKeys: store.stageNlKey(sceneId),
        outputKeys: store.stageKey(sceneId),
    })) {
        ctx.info(`[buildSceneStage:PassA] ${sceneId} 结构化缓存仍新鲜，跳过提取`);
        const cached = store.getStage(sceneId);
        if (cached) return cached;
    }

    const nl = store.getStageNl(sceneId);
    if (!nl) throwPrecondition(`[buildSceneStage:PassA] ${sceneId} 缺少NL草稿`);

    const result = await safefmt(
        nl,
        Output.object({ schema: StaticStageSchema }),
        ctx,
    );

    if (!result.success || !result.value) {
        throwPrecondition(`[buildSceneStage:PassA] ${sceneId} 静态舞台抽取失败`);
    }

    const stage = toSceneStage(result.value.output, sceneId);
    store.saveStage(sceneId, stage);
    ctx.info(`[buildSceneStage:PassA] ${sceneId} 静态舞台抽取完成，实体数=${stage.entities.length}`);
    return stage;
}

// ============================================================
// Pass B：节拍时间线
// ============================================================

async function runPassB(
    ctx: IRunnerContext,
    sceneId: string,
    stage: SceneStage,
    sceneText: string,
): Promise<Beat[]> {
    const store = new Storage(ctx);
    const roster = buildRoster(stage.entities.map(e => ({ name: e.name, kind: e.kind })));

    // 门控：Pass B NL 草稿
    if (!checkExpiry(ctx, {
        inputKeys: store.stageKey(sceneId),
        outputKeys: store.beatNlKey(sceneId),
    })) {
        ctx.info(`[buildSceneStage:PassB] ${sceneId} beat NL草稿仍新鲜，跳过生成`);
    } else {
        const stageSummary = [
            `环境：${stage.world.environment}`,
            `光线：${stage.world.key_light ?? "无"}`,
            `开场站位：${stage.spatial_layout ?? "无"}`,
        ].join("\n");

        const { text } = await generateText({
            model: getSmartModel(undefined, ctx),
            system: BEAT_ANALYZER_PROMPT.system(roster),
            prompt: BEAT_ANALYZER_PROMPT.user(stageSummary, sceneText),
        });
        store.saveBeatNl(sceneId, text);
        ctx.info(`[buildSceneStage:PassB] ${sceneId} beat NL草稿完成 ${text.length}字`);
    }

    // 门控：Pass B safefmt 提取
    if (!checkExpiry(ctx, {
        inputKeys: store.beatNlKey(sceneId),
        outputKeys: store.beatsKey(sceneId),
    })) {
        ctx.info(`[buildSceneStage:PassB] ${sceneId} beat缓存仍新鲜，跳过提取`);
        const cached = store.getBeats(sceneId);
        if (cached) return cached;
    }

    const nl = store.getBeatNl(sceneId);
    if (!nl) throwPrecondition(`[buildSceneStage:PassB] ${sceneId} 缺少beat NL草稿`);

    const result = await safefmt(
        nl,
        Output.object({ schema: BeatsSchema }),
        ctx,
    );

    if (!result.success || !result.value) {
        throwPrecondition(`[buildSceneStage:PassB] ${sceneId} 节拍时间线抽取失败`);
    }

    const beats = toBeats(result.value.output);

    // 程序化校验：deltas 只能引用本场实体（越界仅告警，不丢弃）
    const known = new Set(stage.entities.map(e => e.name));
    for (const b of beats) {
        for (const d of b.deltas) {
            if (!known.has(d.entity)) {
                ctx.warn(`[buildSceneStage:PassB] ${sceneId} 节拍${b.index} 引用了清单外实体「${d.entity}」`);
            }
        }
    }

    store.saveBeats(sceneId, beats);
    ctx.info(`[buildSceneStage:PassB] ${sceneId} 节拍抽取完成，节拍数=${beats.length}`);
    return beats;
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

    ctx.info(`[buildSceneStage] ${sceneId} 两Pass完成`);
}