// nodes/build-stage/scene-stage-builder.ts
import { getSmartModel } from "$libs/model/balancer/get-smart-model.js";
import { safefmt } from "$libs/model/llm/outline.js";
import type { IRunnerContext } from "$types/blueprint/context.js";
import { ModelTags } from "$types/shared/model.js";
import { generateText, Output } from "ai";
import { z } from "zod";
import { solveLayout } from "./layout-solver.js";
import { STAGE_ANALYZER_PROMPT } from "./prompts/stage-analyzer.js";
import type {
    Beat,
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
    "空间关系：left_of=在左侧，right_of=在右侧，in_front_of=在前方(更靠机位)，" +
    "behind=在后方，on_top_of=叠在其上，near=靠近，next_to=紧邻，holds=持有，at=位于某布景处";

const STATIC_SCHEMA = z.object({
    world: z.object({
        environment: z.string().describe("布景环境的自然语言描述：地点、光线、色调、材质、氛围"),
        floor_width: z.number().describe("舞台左右跨度，单位米，如 6"),
        floor_depth: z.number().describe("舞台前后进深，单位米，如 5"),
        ceiling_height: z.number().describe("顶棚高度，单位米，室内约 2.5-3，室外可给 10 以上"),
    }),
    entities: z.array(z.object({
        id: z.string().describe("场景内稳定编号，格式 e 加两位数字，如 e01"),
        kind: z.enum(["character", "prop", "set", "light"])
            .describe("实体类别：character=人物，prop=可拿动道具，set=固定布景陈设，light=光源"),
        label: z.string().describe("实体名称，如 林夏 / 木质书架 / 台灯"),
        sizeClass: z.enum([
            "human", "small_prop", "medium_prop", "large_prop",
            "furniture", "set_piece", "point_light", "area_light",
        ]).describe("粗尺寸档位：human=真人，small/medium/large_prop=小/中/大道具，furniture=桌椅家具，set_piece=书架墙门等大布景，point/area_light=点/面光源"),
    })).describe("场景内全部可见实体，编号连续不重复"),
    relations: z.array(z.object({
        subject: z.string().describe("主体实体编号，如 e01"),
        relation: z.enum(RELATION_ENUM).describe(RELATION_DESC),
        object: z.string().describe("参照物实体编号，如 e02"),
        note: z.string().nullable().describe("补充说明，无则 null"),
    })).describe("开场瞬间的初始站位关系，尽量让每个实体都被锚定"),
});

const BEATS_SCHEMA = z.object({
    beats: z.array(z.object({
        index: z.number().describe("节拍序号，从 1 递增"),
        summary: z.string().describe("这一拍发生了什么，一句话"),
        relations: z.array(z.object({
            subject: z.string().describe("主体实体编号"),
            relation: z.enum(RELATION_ENUM).describe(RELATION_DESC),
            object: z.string().describe("参照物实体编号"),
            note: z.string().nullable().describe("补充说明，无则 null"),
        })).describe("这一拍新增或改变的空间关系；没有则空数组"),
        deltas: z.array(z.object({
            entity_id: z.string().describe("发生动作的实体编号"),
            action: z.string().nullable().describe("视觉可见的行为动作，无则 null"),
            dialogue: z.string().nullable().describe("台词原文，无则 null"),
            moves_to: z.string().nullable().describe("移动目标实体编号或自由描述，无则 null"),
            new_facing: z.string().nullable().describe("新朝向，如 面向 e02；无则 null"),
        })).describe("本拍各个体独立的动作/台词，可并行"),
    })).describe("按剧本时间顺序排列的变动节拍序列"),
});


type StaticOut = z.infer<typeof STATIC_SCHEMA>;
type BeatsOut = z.infer<typeof BEATS_SCHEMA>;

export async function buildSceneStage(
    ctx: IRunnerContext,
    sceneMeta: string,
    sceneText: string,
    sceneId: string,
): Promise<SceneStage | null> {
    const model = getSmartModel({ requiredAbilities: [ModelTags.Reasoning] }, ctx);

    // ===== Pass 1：静态舞台 =====
    const { text: staticReport } = await generateText({
        model,
        system: STAGE_ANALYZER_PROMPT.staticSystem,
        prompt: STAGE_ANALYZER_PROMPT.staticUser(sceneMeta, sceneText),
    });

    const staticRes = await safefmt(
        staticReport,
        Output.object({ schema: STATIC_SCHEMA }),
        ctx,
    );
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
    };
    const entities: StageEntity[] = s.entities.map((e) => ({
        id: e.id,
        kind: e.kind,
        label: e.label,
        sizeClass: e.sizeClass,
    }));
    const validIds = new Set(entities.map((e) => e.id));
    const baseRelations: SpatialRelation[] = s.relations
        .filter((r) => validIds.has(r.subject) && validIds.has(r.object))
        .map((r) => ({
            subject: r.subject,
            relation: r.relation as RelationKind,
            object: r.object,
            note: r.note ?? undefined,
        }));

    // ===== Pass 2：变动节拍 =====
    const roster = entities
        .map((e) => `- ${e.id}｜${e.kind}｜${e.label}`)
        .join("\n");

    const { text: beatReport } = await generateText({
        model,
        system: STAGE_ANALYZER_PROMPT.beatSystem(roster),
        prompt: STAGE_ANALYZER_PROMPT.beatUser(sceneText),
    });

    const beatRes = await safefmt(
        beatReport,
        Output.object({ schema: BEATS_SCHEMA }),
        ctx,
    );

    let beats: Beat[] = [];
    // ===== Pass 2 取值处 =====
    if (beatRes.success && beatRes.value) {
        const bo: BeatsOut = beatRes.value.output;
        beats = bo.beats.map((b) => ({
            index: b.index,
            summary: b.summary,
            relations: b.relations
                .filter((r) => validIds.has(r.subject) && validIds.has(r.object))
                .map((r) => ({
                    subject: r.subject,
                    relation: r.relation as RelationKind,
                    object: r.object,
                    note: r.note ?? undefined,
                })),
            deltas: b.deltas
                .filter((d) => validIds.has(d.entity_id))
                .map((d) => ({
                    entity_id: d.entity_id,
                    action: d.action ?? undefined,
                    dialogue: d.dialogue ?? undefined,
                    moves_to: d.moves_to ?? undefined,
                    new_facing: d.new_facing ?? undefined,
                })),
        }));
    } else {
        ctx.warn(`[buildSceneStage] ${sceneId} 节拍抽取失败，仅保留静态舞台`);
    }

    // ===== 求解基准布局 =====
    const base_layout = solveLayout(world, entities, baseRelations);

    return { world, entities, beats, base_layout };
}