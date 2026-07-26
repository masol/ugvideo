// nodes/build-stage/scene-stage-builder.ts
import { getSmartModel } from "$libs/model/balancer/get-smart-model.js";
import { safefmt } from "$libs/model/llm/outline.js";
import type { IRunnerContext } from "$types/blueprint/context.js";
import { ModelTags } from "$types/shared/model.js";
import { generateText, Output } from "ai";
import { z } from "zod";
import { solveLayout } from "./layout-solver.js";
import { BEAT_ANALYZER_PROMPT } from "./prompts/beat-analyzer.js";
import { EMOTION_ANALYZER_PROMPT } from "./prompts/emotion-analyzer.js";
import { ENTITY_ANALYZER_PROMPT } from "./prompts/entity-analyzer.js";
import type {
    Beat,
    Hand,
    RelationKind,
    SceneStage,
    SpatialRelation,
    StageEntity,
    StageWorld,
} from "./types.js";

const RELATION_ENUM = [
    "left_of", "right_of", "in_front_of", "behind",
    "on_top_of", "near", "next_to", "holds", "at",
] as const;

const RELATION_DESC =
    "空间关系：left_of=左侧，right_of=右侧，in_front_of=前方(近机位)，behind=后方，" +
    "on_top_of=竖直堆叠其上，near=靠近，next_to=紧邻，holds=持有(附着手部)，at=位于某布景处";

const HAND_ENUM = ["left", "right", "both"] as const;

const STATIC_SCHEMA = z.object({
    world: z.object({
        environment: z.string().describe("布景环境的自然语言描述：地点、光线、色调、材质、氛围"),
        floor_width: z.number().describe("舞台左右跨度，米，如 6"),
        floor_depth: z.number().describe("舞台前后进深，米，如 5"),
        ceiling_height: z.number().describe("顶棚高度，米，室内约2.5-3，室外可给10以上"),
        key_light: z.string().describe("主光基调：主光方向、色温(暖/冷/中性)、软硬(硬光/柔光)"),
    }),
    entities: z.array(z.object({
        id: z.string().describe("场景内稳定编号，格式 e 加两位数字，如 e01"),
        kind: z.enum(["character", "prop", "set", "light"])
            .describe("character=人物，prop=可拿动道具，set=固定布景，light=光源"),
        label: z.string().describe("实体本场称呼，如 林夏/木质书架/台灯"),
        sizeClass: z.enum([
            "human", "small_prop", "medium_prop", "large_prop",
            "furniture", "set_piece", "point_light", "area_light",
        ]).describe("粗尺寸档位"),
        appearance: z.string().describe("可直接用于图像生成的具体视觉外观描述，避免抽象形容词"),
        alignment_hint: z.string().describe("该实体最稳定、最有区分度的跨场景识别特征，供对齐判断"),
        scene_overrides: z.string().nullable().describe("本场相对常态的差异(伤痕/破损/沾染)，无则 null"),
    })).describe("场景内全部可见实体，编号连续不重复"),
    relations: z.array(z.object({
        subject: z.string().describe("主体实体编号"),
        relation: z.enum(RELATION_ENUM).describe(RELATION_DESC),
        object: z.string().describe("参照物实体编号"),
        hand: z.enum(HAND_ENUM).nullable().describe("仅 holds 关系填写：left/right/both；否则 null"),
        note: z.string().nullable().describe("补充说明，无则 null"),
    })).describe("开场瞬间的初始站位关系，尽量锚定每个实体"),
});

const BEATS_SCHEMA = z.object({
    beats: z.array(z.object({
        index: z.number().describe("节拍序号，从1递增"),
        duration_hint: z.string().nullable().describe("语义时长，如'约3秒'，无则 null"),
        summary: z.string().describe("这一拍发生了什么，一句话"),
        mood: z.string().nullable().describe("本拍整体情绪基调，无则 null"),
        relations: z.array(z.object({
            subject: z.string().describe("主体实体编号"),
            relation: z.enum(RELATION_ENUM).describe(RELATION_DESC),
            object: z.string().describe("参照物实体编号"),
            hand: z.enum(HAND_ENUM).nullable().describe("仅 holds 填写；否则 null"),
            note: z.string().nullable().describe("补充说明，无则 null"),
        })).describe("本拍新增或改变的空间关系；没有则空数组"),
        deltas: z.array(z.object({
            entity_id: z.string().describe("发生动作的实体编号"),
            action: z.string().nullable().describe("视觉可见动作，无则 null"),
            dialogue: z.string().nullable().describe("台词原文，无则 null"),
            holds: z.array(z.object({
                object_id: z.string().describe("被持有实体编号"),
                hand: z.enum(HAND_ENUM).nullable().describe("left/right/both，无则 null"),
            })).describe("本拍持有的物体；没有则空数组"),
            moves_to: z.string().nullable().describe("移动目标实体编号或描述，无则 null"),
            new_facing: z.string().nullable().describe("新朝向，如'面向 e02'，无则 null"),
            appearance_change: z.string().nullable().describe("本拍新增外观变化(伤痕/破损/沾染)，无则 null"),
            mood: z.string().nullable().describe("该个体本拍情绪，无则 null"),
        })).describe("本拍各个体独立的动作/台词，可并行"),
    })).describe("按剧本时间顺序排列的变动节拍序列"),
});

type StaticOut = z.infer<typeof STATIC_SCHEMA>;
type BeatsOut = z.infer<typeof BEATS_SCHEMA>;

export interface SceneBuildResult {
    stage: SceneStage;
    beats: Beat[];
    emotion: string;
}

export async function buildSceneStage(
    ctx: IRunnerContext,
    sceneMeta: string,
    sceneText: string,
    sceneId: string,
): Promise<SceneBuildResult | null> {
    const model = getSmartModel({ requiredAbilities: [ModelTags.Reasoning] }, ctx);

    // ===== Pass A：静态舞台（环境+实体+外观+拓扑）=====
    const { text: staticReport } = await generateText({
        model,
        system: ENTITY_ANALYZER_PROMPT.system,
        prompt: ENTITY_ANALYZER_PROMPT.user(sceneMeta, sceneText),
    });
    const staticRes = await safefmt(staticReport, Output.object({ schema: STATIC_SCHEMA }), ctx);
    if (!staticRes.success || !staticRes.value) {
        ctx.warn(`[buildSceneStage] ${sceneId} 静态舞台抽取失败`);
        return null;
    }
    const s: StaticOut = staticRes.value.output;

    const world: StageWorld = {
        scene_id: sceneId,
        environment: s.world.environment,
        floor_width: Math.max(2, s.world.floor_width),
        floor_depth: Math.max(2, s.world.floor_depth),
        ceiling_height: Math.max(2, s.world.ceiling_height),
        key_light: s.world.key_light,
    };
    const entities: StageEntity[] = s.entities.map((e) => ({
        id: e.id,
        kind: e.kind,
        label: e.label,
        sizeClass: e.sizeClass,
        appearance: e.appearance,
        alignment_hint: e.alignment_hint,
        scene_overrides: e.scene_overrides ?? undefined,
    }));
    const validIds = new Set(entities.map((e) => e.id));
    const baseRelations: SpatialRelation[] = s.relations
        .filter((r) => validIds.has(r.subject) && validIds.has(r.object))
        .map((r) => ({
            subject: r.subject,
            relation: r.relation as RelationKind,
            object: r.object,
            hand: (r.hand as Hand) ?? undefined,
            note: r.note ?? undefined,
        }));

    // ===== Pass B：变动节拍 =====
    const roster = entities.map((e) => `- ${e.id}｜${e.kind}｜${e.label}`).join("\n");
    const { text: beatReport } = await generateText({
        model,
        system: BEAT_ANALYZER_PROMPT.system(roster),
        prompt: BEAT_ANALYZER_PROMPT.user(sceneText),
    });
    const beatRes = await safefmt(beatReport, Output.object({ schema: BEATS_SCHEMA }), ctx);

    let beats: Beat[] = [];
    if (beatRes.success && beatRes.value) {
        const bo: BeatsOut = beatRes.value.output;
        beats = bo.beats.map((b) => ({
            index: b.index,
            duration_hint: b.duration_hint ?? undefined,
            summary: b.summary,
            mood: b.mood ?? undefined,
            relations: b.relations
                .filter((r) => validIds.has(r.subject) && validIds.has(r.object))
                .map((r) => ({
                    subject: r.subject,
                    relation: r.relation as RelationKind,
                    object: r.object,
                    hand: (r.hand as Hand) ?? undefined,
                    note: r.note ?? undefined,
                })),
            deltas: b.deltas
                .filter((d) => validIds.has(d.entity_id))
                .map((d) => ({
                    entity_id: d.entity_id,
                    action: d.action ?? undefined,
                    dialogue: d.dialogue ?? undefined,
                    holds: (d.holds ?? [])
                        .filter((h) => validIds.has(h.object_id))
                        .map((h) => ({ object_id: h.object_id, hand: (h.hand as Hand) ?? undefined })),
                    moves_to: d.moves_to ?? undefined,
                    new_facing: d.new_facing ?? undefined,
                    appearance_change: d.appearance_change ?? undefined,
                    mood: d.mood ?? undefined,
                })),
        }));
    } else {
        ctx.warn(`[buildSceneStage] ${sceneId} 节拍抽取失败，仅保留静态舞台`);
    }

    // ===== Pass C：情绪简报（NL）=====
    const { text: emotion } = await generateText({
        model,
        system: EMOTION_ANALYZER_PROMPT.system,
        prompt: EMOTION_ANALYZER_PROMPT.user(sceneMeta, sceneText),
    });

    // ===== 粗布局（梦境级物理）=====
    const base_layout = solveLayout(world, entities, baseRelations);

    return { stage: { world, entities, base_layout }, beats, emotion };
}