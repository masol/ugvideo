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
import type { Beat, BeatDelta, BeatHold, SceneStage, StageEntity, StageWorld } from "./types.js";

// ============================================================
// safefmt Schema —静态舞台（Pass A）
// ============================================================

const StaticStageSchema = z.object({
    world: z.object({
        environment: z.string()
            .describe("布景环境自然语言描述：地点、光线、色调、材质、氛围，如'室内传统中式禅院主厅，青灰砖地面，暖木色调，空气中微尘浮动'"),
        key_light: z.string()
            .describe("主光基调，格式：方向/色温(暖色调|冷色调|中性)/软硬(硬光|柔光)，如'顶部偏左/暖色调/硬光'"),
    }),
    entities: z.array(
        z.object({
            id: z.string()
                .describe("场景内编号，格式为字母 e加两位数字，如 e01、e02，连续不重复"),
            kind: z.enum(["character", "prop", "set", "light"])
                .describe("实体大类，只能从这四个中选一个：character=人物角色；prop=可被拿起移动的道具(茶壶/武器/书本/鱼干等)；set=固定或半固定陈设(桌/椅/床/门/窗/地面/墙壁/法盆/书架等一切场景物件，家具全部选set，不要选其他值)；light=光源"),
            label: z.string()
                .describe("实体在本场景中的称呼，如'林乃龙'、'石制法盆'、'双扇木门'"),
            appearance: z.string()
                .describe("可直接用于图像生成的具体视觉外观：人物写发型发色/五官/服装材质颜色/配饰，道具写形状材质颜色磨损，布景写材质颜色年代感，避免'英俊'/'古朴'等抽象词"),
            alignment_hint: z.string()
                .describe("该实体跨场景最稳定、最有区分度的识别特征，如'左颧骨旧疤+齐肩黑发'、'盆沿右侧燕尾状缺口'，供跨场景对齐判断"),
            scene_overrides: z.string().nullable()
                .describe("本场相对常态的外观差异，如'右肩衣袖大面积撕裂'、'全身沾满泥浆'；无差异则填null"),
        })
    ).describe("场景中所有可见实体的完整清单，不遗漏任何人物、道具、布景和光源"),
    spatial_layout: z.string()
        .describe("开场瞬间所有实体相对位置与姿态的自然语言整体描述：谁在谁的左侧/右侧/正前方/身后/上方，谁跪谁站，谁持有什么(注明哪只手)，谁盘绕/倚靠/包围谁，谁悬挂在何处——可自由使用任何方位词，不受词汇表限制，每个实体至少被提及一次"),
});

type RawStaticStage = z.infer<typeof StaticStageSchema>;

// ============================================================
// safefmt Schema — 节拍时间线（Pass B）
// ============================================================

const BeatHoldSchema = z.object({
    object_id: z.string()
        .describe("被持有物体的实体编号，必须是 Pass A 清单中已登记的 e01/e02 等"),
    hand: z.enum(["left", "right", "both"]).optional()
        .describe("持有所用的手：left=左手，right=右手，both=双手"),
});

const BeatDeltaSchema = z.object({
    entity_id: z.string()
        .describe("发生变化的实体编号，必须是 Pass A 清单中已登记的 e01/e02 等"),
    action: z.string().optional()
        .describe("本拍视觉可见行为，如'双膝触地行大礼'、'飞掠降落盘旋'；纯心理活动不写"),
    dialogue: z.string().nullable().optional()
        .describe("本拍台词原文；无台词则填 null 或省略"),
    holds: z.array(BeatHoldSchema).optional()
        .describe("本拍新拿起的物体列表；无新增持有则省略或填空数组"),
    moves_to: z.string().optional()
        .describe("移动目标的自然语言描述，如'走向e02身旁'、'退至画面右侧'；无移动则省略"),
    new_facing: z.string().optional()
        .describe("朝向变化的自然语言描述，如'转身面向e02'；无变化则省略"),
    appearance_change: z.string().optional()
        .describe("本拍外观/状态增量，如'嘴角溢出血水'、'衣袖撕裂加剧'；无变化则省略"),
    mood: z.string().optional()
        .describe("该个体本拍情绪，如'卑微绝望'、'狂热贪婪'，供TTS语气参考；可省略"),
});

const BeatSchema = z.object({
    index: z.number().int()
        .describe("节拍序号，从 1 开始，连续递增"),
    duration_hint: z.string().optional()
        .describe("语义时长估计，如'约3秒'、'约5秒'；不确定则省略"),
    summary: z.string()
        .describe("本拍核心事件一句话概括，包含主要动作主体和结果"),
    mood: z.string().optional()
        .describe("本拍整体情绪基调，如'压抑转神圣'、'凝重决绝'"),
    staging: z.string().optional()
        .describe("本拍站位/空间关系变化的自然语言描述，可自由使用任意方位词(盘绕/跪于/倚靠/包围/持有/悬于等)；若本拍无任何位置变化则省略此字段"),
    deltas: z.array(BeatDeltaSchema)
        .describe("本拍有变化的实体列表；本拍无变化的实体不列出"),
});

const BeatsSchema = z.object({
    beats: z.array(BeatSchema)
        .describe("按剧本时间顺序排列的完整节拍序列，不遗漏任何时间切片"),
});

type RawBeats = z.infer<typeof BeatsSchema>;

// ============================================================
// 内部工具
// ============================================================

/** 把实体清单压成一行 roster，给 Pass B 用 */
function buildRoster(
    entities: Array<{ id: string; kind: string; label: string }>,
): string {
    return entities
        .map(e => `${e.id}｜${e.kind}｜${e.label}`)
        .join("\n");
}

/** RawStaticStage → SceneStage（类型映射，不做JSON 转换） */
function toSceneStage(raw: RawStaticStage, sceneId: string): SceneStage {
    const world: StageWorld = {
        scene_id: sceneId,
        environment: raw.world.environment,
        key_light: raw.world.key_light,
    };
    const entities: StageEntity[] = raw.entities.map(e => ({
        id: e.id,
        kind: e.kind,
        label: e.label,
        appearance: e.appearance,
        alignment_hint: e.alignment_hint,
        scene_overrides: e.scene_overrides ?? undefined,
    }));
    return { world, entities, spatial_layout: raw.spatial_layout };
}

/** RawBeats → Beat[]（类型映射） */
function toBeats(raw: RawBeats): Beat[] {
    return raw.beats.map(b => ({
        index: b.index,
        duration_hint: b.duration_hint,
        summary: b.summary,
        mood: b.mood,
        staging: b.staging,
        deltas: (b.deltas ?? []).map((d): BeatDelta => ({
            entity_id: d.entity_id,
            action: d.action,
            dialogue: d.dialogue ?? undefined,
            holds: (d.holds ?? []).map((h): BeatHold => ({
                object_id: h.object_id,
                hand: h.hand,
            })),
            moves_to: d.moves_to,
            new_facing: d.new_facing,
            appearance_change: d.appearance_change,
            mood: d.mood,
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
    const roster = buildRoster(
        stage.entities.map(e => ({ id: e.id, kind: e.kind, label: e.label }))
    );

    // 门控：Pass B NL 草稿
    if (!checkExpiry(ctx, {
        inputKeys: store.stageKey(sceneId),
        outputKeys: store.beatNlKey(sceneId),
    })) {
        ctx.info(`[buildSceneStage:PassB] ${sceneId} beat NL草稿仍新鲜，跳过生成`);
    } else {
        const stageSummary = [
            `场景：${stage.world.environment}`,
            `主光：${stage.world.key_light}`,
            `开场布局：${stage.spatial_layout}`,
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