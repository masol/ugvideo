// nodes/generate-reference-images/render/render-dispatcher.ts
import type { IRunnerContext } from "$types/blueprint/context.js";
import pMap from "p-map";
import { RefImgStorage } from "../storage.js";
import type { RenderTask } from "../types.js";
import type { RenderFn } from "./render-types.js";

/**
 * 渲染调度（按场景隔离的 task id）。
 * task id 格式：
 * - 实体参考图：`${sceneId}__${entityName}`
 * - 制服：`uniform:${name}`
 * - 环境图：`env:${sceneId}`
 */
export async function dispatchRenderTasks(
    ctx: IRunnerContext,
    tasks: RenderTask[],
    renderFn: RenderFn,
): Promise<{ succeeded: number; failed: number }> {
    const store = new RefImgStorage(ctx);

    let succeeded = 0;
    let failed = 0;

    const results = await pMap(
        tasks,
        async (task) => {
            const existing = store.getRenderResult(task.id);
            if (existing && existing.file_path) {
                ctx.info(`[render-dispatcher] ${task.id} 已渲染，跳过`);
                return { ok: true as const };
            }

            const result = await renderFn(ctx, task);

            if (!result || !result.file_path) {
                ctx.warn(`[render-dispatcher] ${task.id} 渲染失败`);
                return { ok: false as const };
            }

            store.saveRenderResult(result);
            ctx.info(`[render-dispatcher] ${task.id} 渲染完成：${result.file_path}`);
            return { ok: true as const };
        },
        { concurrency: 3 },
    );

    for (const r of results) {
        if (r.ok) succeeded++;
        else failed++;
    }

    ctx.info(`[render-dispatcher] 渲染完成，成功 ${succeeded}，失败 ${failed}`);
    return { succeeded, failed };
}