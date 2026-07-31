/* eslint-disable @typescript-eslint/no-explicit-any */
// nodes/render-images/index.ts
import { checkExpiry } from "$libs/blueprint/glossary/expiry.js";
import type { IRunnerContext } from "$types/blueprint/context.js";
import pMap from "p-map";
import { RefImgStorage } from "../generate-reference-images/storage.js";
import { renderTask } from "./renderer.js";
import { RenderStorage } from "./storage.js";
import type { RenderResult } from "./types.js";

const P = "#video:";
const MAX_CONCURRENT_RENDER = 3;

export async function renderImages(ctx: IRunnerContext): Promise<void> {
    const refStore = new RefImgStorage(ctx);
    const renderStore = new RenderStorage(ctx);

    const tasks = refStore.getRenderTasks();
    if (!tasks.length) {
        ctx.info("[renderImages] 无渲染任务，跳过");
        return;
    }

    // 过滤已渲染的任务
    const pendingTasks = tasks.filter(t => !renderStore.getRenderResult(t.id));

    if (!pendingTasks.length) {
        ctx.info(`[renderImages] 全部 ${tasks.length} 个任务已渲染，跳过`);
        return;
    }

    ctx.info(`[renderImages] 待渲染 ${pendingTasks.length}/${tasks.length} 个任务`);

    let succeeded = 0;
    let failed = 0;

    await pMap(
        pendingTasks,
        async (task) => {
            const result = await renderTask(ctx, task);
            if (!result) {
                failed++;
                return;
            }
            renderStore.saveRenderResult(result);
            succeeded++;
            ctx.info(`[renderImages] ${task.id} 完成：${result.file_path}`);
        },
        { concurrency: MAX_CONCURRENT_RENDER },
    );

    ctx.info(`[renderImages] 渲染完成，成功 ${succeeded}，失败 ${failed}`);

    await buildOverview(ctx, renderStore);
}

async function buildOverview(ctx: IRunnerContext, store: RenderStorage): Promise<void> {
    const refStore = new RefImgStorage(ctx);
    const tasks = refStore.getRenderTasks();
    const renderedIds = store.renderedIds();

    if (!checkExpiry(ctx, {
        inputKeys: tasks.map(t => {
            if (t.type === "scene_environment") return `${P}refimg:env_${t.scene_id}`;
            if (t.type === "uniform_turnaround") return `${P}refimg:uniform_${t.id.replace(/^uniform:/, "")}`;
            const parsed = refStore.parseEntityRefsheetKey(t.id);
            return parsed ? `${P}refimg:entity_${parsed.sceneId}_${parsed.entityName}` : t.id;
        }),
        outputKeys: store.overviewKey(),
    })) {
        ctx.info("[renderImages:overview] 总览仍新鲜，跳过");
        return;
    }

    const sections: string[] = [`# 渲染结果总览（共 ${tasks.length} 个任务，已完成 ${renderedIds.length}）`];

    for (const task of tasks) {
        const result = store.getRenderResult(task.id);
        sections.push(renderTaskSection(task, result));
    }

    const overview = sections.join("\n\n");
    store.saveOverview(overview);
    ctx.info(`[renderImages:overview] 总览完成 ${overview.length}字`);
}

function renderTaskSection(task: any, result: RenderResult | null): string {
    const status = result ? `✓ ${result.file_path}` : "✗ 未渲染";
    const promptPreview = task.prompt.slice(0, 200);
    return [
        `## ${task.id}（${task.type}）`,
        `状态：${status}`,
        `参考图数：${task.reference_images?.length ?? 0}`,
        `提示词预览：${promptPreview}${task.prompt.length > 200 ? "..." : ""}`,
    ].join("\n");
}