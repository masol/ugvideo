// nodes/build-stage/index.ts
import { getIOByKeys } from "$libs/blueprint/glossary/ioinfo.js";
import { PrjDB } from "$libs/project/controllers/drizzle/index.js";
import type { IRunnerContext } from "$types/blueprint/context.js";
import pMap from "p-map";
import { ParseStorage } from "../parse-script/storage.js";
import { alignSceneEntities, refLabel } from "./entity-aligner.js";
import { buildSceneStage } from "./scene-stage-builder.js";
import { loadScriptLines, sliceScene } from "./script-lines.js";
import { StageStorage } from "./storage.js";

/**
 * 工作流第二步：为每个已解析场景构建导演台（世界模型）。
 *
 * 依赖：parse-script 的 parse:idx:scenes / parse:scene:*
 *      （原始 script 仅由 loadScriptLines 用于取回场景原文）
 *
 * 产出多表：
 *   stage:scene:*     场景静态舞台（world + 局部实体 + 粗布局）
 *   stage:beats:*     节拍时间线（动态变化）
 *   stage:emotion:*   场景情绪简报
 *   stage:registry:*  全局实体登记册（跨场景身份 + 出图记忆）
 *   state:stages_nl   下游总览
 *
 * 门控源为真正的上游产出 parse:idx:scenes，而非 script。
 */
export async function buildStages(ctx: IRunnerContext): Promise<void> {
    const prjdb = PrjDB.ensure(ctx.prj);

    const io = getIOByKeys(ctx, {
        inputs: "parse:idx:scenes",
        outputs: "state:stages_nl",
    });
    if (!io.expired) {
        ctx.info("[buildStages] 导演台仍新鲜，跳过");
        return;
    }

    const parseStore = new ParseStorage(ctx);
    const stageStore = new StageStorage(prjdb);

    const sceneIds = parseStore.listSceneIds();
    if (sceneIds.length === 0) {
        ctx.warn("[buildStages] 无场景数据，请先运行 parseScript");
        return;
    }

    const lines = loadScriptLines(ctx);

    // 叙事顺序
    const ordered = sceneIds
        .map((id) => parseStore.loadScene(id))
        .filter((s): s is NonNullable<typeof s> => s != null)
        .sort((a, b) => a.line_start - b.line_start);

    ctx.notify("阶段一·导演台", `开始为 ${ordered.length} 个场景构建世界模型`);

    // ===== Pass A/B/C：并发构建各场景（彼此独立）=====
    await pMap(ordered, async (scene) => {
        const sceneText = sliceScene(lines, scene.line_start, scene.line_end);
        if (!sceneText.trim()) return;

        const meta = [
            `场景：${scene.scene_id} ${scene.title}`,
            `地点：${scene.context.location ?? "(待定)"}`,
            `时间：${scene.context.timeOfDay ?? "(待定)"}`,
            `在场人物：${scene.context.charactersInvolved?.join("、") || "(待定)"}`,
        ].join("\n");

        const result = await buildSceneStage(ctx, meta, sceneText, scene.scene_id);
        if (result) {
            stageStore.saveStage(result.stage);
            stageStore.saveBeats(scene.scene_id, result.beats);
            stageStore.saveEmotion(scene.scene_id, result.emotion);
            ctx.info(
                `[buildStages] ${scene.scene_id} 完成：` +
                `${result.stage.entities.length} 实体，${result.beats.length} 节拍`,
            );
        }
    }, { concurrency: 3 });

    // ===== Pass D：跨场景对齐（必须按叙事顺序串行，登记册增长）=====
    ctx.notify("阶段一·实体对齐", "正在跨场景归并全局实体...");
    for (const scene of ordered) {
        await alignSceneEntities(ctx, stageStore, scene.scene_id);
    }

    // ===== 下游总览 =====
    const summaryParts: string[] = [];
    for (const id of stageStore.listStageIds()) {
        const stage = stageStore.loadStage(id);
        if (!stage) continue;
        const beats = stageStore.loadBeats(id);
        const entityLines = stage.entities
            .map((e) => {
                const t = stage.base_layout.find((x) => x.id === e.id);
                const pos = t ? `(${t.position.join(", ")})` : "(未解算)";
                return `- ${refLabel(stageStore, e)}｜${e.kind}｜位置 ${pos}`;
            })
            .join("\n");
        summaryParts.push([
            `### ${stage.world.scene_id}`,
            `环境：${stage.world.environment}`,
            `主光：${stage.world.key_light}`,
            `尺度：${stage.world.floor_width}×${stage.world.floor_depth}×${stage.world.ceiling_height} m`,
            `实体布局：`,
            entityLines,
            `节拍数：${beats.length}`,
            ``,
        ].join("\n"));
    }
    stageStore.saveStagesSummary(summaryParts.join("\n---\n\n"));

    ctx.notify(
        "阶段一·导演台",
        `导演台构建完成：${stageStore.listStageIds().length} 场景，${stageStore.listGlobalIds().length} 全局实体`,
    );
    ctx.info(`[buildStages] 完成`);
}