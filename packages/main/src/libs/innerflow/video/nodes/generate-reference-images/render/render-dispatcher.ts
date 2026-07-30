// nodes/generate-reference-images/render/render-dispatcher.ts
import type { IRunnerContext } from "$types/blueprint/context.js";
import pMap from "p-map";
import { RefImgStorage } from "../storage.js";
import type { RenderTask } from "../types.js";
import type { RenderFn } from "./render-types.js";

/**
 * 参考图/环境图渲染调度。
 *
 * 参考图之间相互独立（都是纯白背景独立图），不构建依赖图，直接并行渲染。
 * 参考图间的引用关系由下游"场景镜头提示词"环节处理。
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