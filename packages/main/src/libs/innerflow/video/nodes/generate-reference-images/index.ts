// nodes/generate-reference-images/index.ts
import { checkExpiry } from "$libs/blueprint/glossary/expiry.js";
import type { IRunnerContext } from "$types/blueprint/context.js";
import pMap from "p-map";
import { generateSceneEnvironment } from "./environment-generator.js";
import { generateEntityRefsheet } from "./refsheet-generator.js";
import { defaultRender } from "./render/default-renderer.js";
import { dispatchRenderTasks } from "./render/render-dispatcher.js";
import { RefImgStorage } from "./storage.js";
import type { EntityRefsheetPrompt, RenderResult, RenderTask, SceneEnvironmentPrompt } from "./types.js";

/**
 * generate-reference-images 节点：为每个实体生成定妆照提示词，为每个场景生成环境基底图提示词，
 * 按依赖图拓扑排序后并行渲染。
 */
export async function generateReferenceImages(ctx: IRunnerContext): Promise<void> {
    const store = new RefImgStorage(ctx);
    const entityNames = store.entityNames();
    const sceneIds = store.sceneIds();

    if (!entityNames.length && !sceneIds.length) {
        ctx.info("[generateReferenceImages] 无实体和场景，跳过");
        return;
    }

    // ===== Phase 1: 实体定妆照提示词（并发）=====
    if (entityNames.length > 0) {
        ctx.info(`[generateReferenceImages] 开始生成 ${entityNames.length} 个实体定妆照提示词`);

        await pMap(
            entityNames,
            async (name) => {
                await generateEntityRefsheet(ctx, name);
            },
            { concurrency: 4 },
        );

        const generated = store.generatedEntityNames();
        ctx.info(`[generateReferenceImages] 实体定妆照提示词完成 ${generated.length}/${entityNames.length}`);
    }

    // ===== Phase 2: 场景环境图提示词（并发）=====
    if (sceneIds.length > 0) {
        ctx.info(`[generateReferenceImages] 开始生成 ${sceneIds.length} 个场景环境图提示词`);

        await pMap(
            sceneIds,
            async (sceneId) => {
                await generateSceneEnvironment(ctx, sceneId);
            },
            { concurrency: 3 },
        );

        const generatedScenes = store.generatedSceneIds();
        ctx.info(`[generateReferenceImages] 场景环境图提示词完成 ${generatedScenes.length}/${sceneIds.length}`);
    }

    // ===== Phase 3: 构建渲染任务 =====
    const tasks: RenderTask[] = [];

    for (const name of store.generatedEntityNames()) {
        const prompt = store.getEntityRefsheet(name);
        if (!prompt) continue;

        const asset = store.getEntityAsset(name);
        tasks.push({
            id: name,
            type: "entity_refsheet",
            prompt: prompt.prompt,
            dependencies: prompt.dependencies,
            asset_info: asset ? {
                entity_name: name,
                kind: asset.kind,
                layout: prompt.layout,
                humanoid: prompt.humanoid,
                base_description: asset.base_description,
                scene_delta: asset.scene_delta,
                lighting_effect: asset.lighting_effect,
            } : undefined,
        });
    }

    for (const sceneId of store.generatedSceneIds()) {
        const env = store.getSceneEnvironment(sceneId);
        if (!env) continue;

        const stage = store.getStage(sceneId);
        const lighting = store.getLighting(sceneId);

        tasks.push({
            id: sceneId,
            type: "scene_environment",
            prompt: env.prompt,
            dependencies: env.dependencies,
            scene_info: stage && lighting ? {
                scene_id: sceneId,
                environment: stage.world.environment,
                lighting_summary: lighting.summary,
            } : undefined,
        });
    }

    // ===== Phase 4: 按依赖图拓扑排序后并行渲染 =====
    if (tasks.length > 0) {
        ctx.info(`[generateReferenceImages] 开始渲染 ${tasks.length} 个参考图`);
        await dispatchRenderTasks(ctx, tasks, defaultRender);
        ctx.info(`[generateReferenceImages] 渲染调度完成`);
    }

    // ===== Phase 5: 总览 =====
    await buildOverview(ctx);
}

async function buildOverview(ctx: IRunnerContext): Promise<void> {
    const store = new RefImgStorage(ctx);

    if (!checkExpiry(ctx, {
        inputKeys: [
            ...store.generatedEntityNames().map(n => store.entityRefsheetKey(n)),
            ...store.generatedSceneIds().map(id => store.sceneEnvironmentKey(id)),
            ...store.generatedEntityNames().map(n => store.renderResultKey(n)),
            ...store.generatedSceneIds().map(id => store.renderResultKey(id)),
        ],
        outputKeys: store.overviewKey(),
    })) {
        ctx.info("[generateReferenceImages:overview] 总览仍新鲜，跳过");
        return;
    }

    const sections: string[] = [];

    const entityNames = store.generatedEntityNames();
    if (entityNames.length) {
        sections.push("# 实体定妆照清单");
        for (const name of entityNames) {
            const prompt = store.getEntityRefsheet(name);
            const result = store.getRenderResult(name);
            if (prompt) {
                sections.push(renderEntitySection(name, prompt, result));
            }
        }
    }

    const sceneIds = store.generatedSceneIds();
    if (sceneIds.length) {
        sections.push("# 场景环境图清单");
        for (const sceneId of sceneIds) {
            const env = store.getSceneEnvironment(sceneId);
            const result = store.getRenderResult(sceneId);
            if (env) {
                sections.push(renderSceneSection(sceneId, env, result));
            }
        }
    }

    const overview = sections.join("\n\n---\n\n");
    store.saveOverview(overview);
    ctx.info(`[generateReferenceImages:overview] 总览完成 ${overview.length}字`);
}

function renderEntitySection(
    name: string,
    prompt: EntityRefsheetPrompt,
    result: RenderResult | null,
): string {
    const layoutLabel = {
        four_column: "16:9 四列布局（正面/左45°/右45°/背面）",
        three_column: "16:9 三列布局（正面/侧面/背面）",
        magazine_grid: "16:9 杂志式网格（上方侧面大图+下方正背小图）",
    }[prompt.layout];

    return [
        `## ${name}（${prompt.kind}${prompt.humanoid ? "·类人" : ""}）`,
        `布局：${layoutLabel}`,
        `来源场景：${prompt.source_scene}`,
        `参考图依赖：${prompt.dependencies.length ? prompt.dependencies.join(", ") : "（无）"}`,
        result && result.file_path ? `渲染结果：${result.file_path}` : `渲染结果：（失败或未渲染）`,
        ``,
        `### 提示词`,
        prompt.prompt,
    ].join("\n");
}

function renderSceneSection(
    sceneId: string,
    env: SceneEnvironmentPrompt,
    result: RenderResult | null,
): string {
    return [
        `## 场景 ${sceneId}`,
        `现实案例参照：${env.real_world_references.join("、") || "（无）"}`,
        `参考图依赖（${env.dependencies.length} 个）：${env.dependencies.join(", ")}`,
        result && result.file_path ? `渲染结果：${result.file_path}` : `渲染结果：（失败或未渲染）`,
        ``,
        `### 环境提示词`,
        env.prompt,
    ].join("\n");
}