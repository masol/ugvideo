// nodes/build-stage/index.ts
import { getIOByKeys } from "$libs/blueprint/glossary/ioinfo.js";
import { PrjDB } from "$libs/project/controllers/drizzle/index.js";
import type { IRunnerContext } from "$types/blueprint/context.js";
import pMap from "p-map";
import { ParseStorage } from "../parse-script/storage.js";
import { buildSceneStage } from "./scene-stage-builder.js";
import { loadScriptLines, sliceScene } from "./script-lines.js";
import { StageStorage } from "./storage.js";

/**
 * 工作流第二步：为每个已解析场景构建导演台（世界模型）。
 * 输入：parse-script 落盘的场景（parse:idx:scenes / parse:scene:*）+ 原始 script
 * 输出：stage:scene:*（每场一个 SceneStage）、state:stages_nl（下游总览）
 */
export async function buildStages(ctx: IRunnerContext): Promise<void> {
    const prjdb = PrjDB.ensure(ctx.prj);

    const io = getIOByKeys(ctx, { inputs: "script", outputs: "state:stages_nl" });
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

    // 按行号排序，保证叙事顺序
    const ordered = sceneIds
        .map((id) => parseStore.loadScene(id))
        .filter((s): s is NonNullable<typeof s> => s != null)
        .sort((a, b) => a.line_start - b.line_start);

    ctx.notify("阶段一·导演台", `开始为 ${ordered.length} 个场景构建世界模型`);

    await pMap(ordered, async (scene) => {
        const sceneText = sliceScene(lines, scene.line_start, scene.line_end);
        if (!sceneText.trim()) return;

        const meta = [
            `场景：${scene.scene_id} ${scene.title}`,
            `地点：${scene.context.location ?? "(待定)"}`,
            `时间：${scene.context.timeOfDay ?? "(待定)"}`,
            `在场人物：${scene.context.charactersInvolved?.join("、") || "(待定)"}`,
        ].join("\n");

        const stage = await buildSceneStage(ctx, meta, sceneText, scene.scene_id);
        if (stage) {
            stageStore.saveStage(stage);
            ctx.info(
                `[buildStages] ${scene.scene_id} 完成：` +
                `${stage.entities.length} 实体，${stage.beats.length} 节拍`,
            );
        }
    }, { concurrency: 3 });

    // ===== 下游总览（自然语言）=====
    const summaryParts: string[] = [];
    for (const id of stageStore.listStageIds()) {
        const stage = stageStore.loadStage(id);
        if (!stage) continue;
        const entityLines = stage.entities
            .map((e) => {
                const t = stage.base_layout.find((x) => x.id === e.id);
                const pos = t ? `(${t.position.join(", ")})` : "(未解算)";
                return `- ${e.id} ${e.label}｜${e.kind}｜位置 ${pos}`;
            })
            .join("\n");
        summaryParts.push(
            [
                `### ${stage.world.scene_id}`,
                `环境：${stage.world.environment}`,
                `尺度：${stage.world.floor_width}×${stage.world.floor_depth}×${stage.world.ceiling_height} m`,
                `实体布局：`,
                entityLines,
                `节拍数：${stage.beats.length}`,
                ``,
            ].join("\n"),
        );
    }

    stageStore.saveStagesSummary(summaryParts.join("\n---\n\n"));
    ctx.notify("阶段一·导演台", `全部 ${stageStore.listStageIds().length} 个导演台构建完成`);
    ctx.info(`[buildStages] 完成`);
}