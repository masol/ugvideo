// nodes/generate-reference-images/render/render-dispatcher.ts
import type { IRunnerContext } from "$types/blueprint/context.js";
import pMap from "p-map";
import { RefImgStorage } from "../storage.js";
import type { RenderTask } from "../types.js";
import { buildDependencyGraph } from "./dependency-graph.js";
import type { RenderFn } from "./render-types.js";

/**
 * 渲染调度器：按依赖图拓扑排序后，逐层并行调用渲染函数。
 *
 * 失败约定：
 * - renderFn 返回 null 或 file_path 为空字符串 → 该任务标记为失败，不存 RenderResult
 * - 失败不阻塞其他任务继续渲染
 */
export async function dispatchRenderTasks(
    ctx: IRunnerContext,
    tasks: RenderTask[],
    renderFn: RenderFn,
): Promise<{ succeeded: number; failed: number }> {
    const store = new RefImgStorage(ctx);
    const layers = buildDependencyGraph(ctx, tasks);

    let succeeded = 0;
    let failed = 0;

    for (let i = 0; i < layers.length; i++) {
        const layer = layers[i];
        ctx.notify("参考图渲染", `第 ${i + 1}/${layers.length} 层，${layer.length} 个任务`);

        const results = await pMap(
            layer,
            async (task) => {
                const existing = store.getRenderResult(task.id);
                if (existing && existing.file_path) {
                    ctx.info(`[render-dispatcher] ${task.id} 已渲染，跳过`);
                    return { id: task.id, ok: true as const };
                }

                const resolvedPrompt = resolveDependencyPlaceholders(ctx, task.prompt, task.dependencies, store);
                const resolvedTask: RenderTask = { ...task, prompt: resolvedPrompt };

                const result = await renderFn(ctx, resolvedTask);

                if (!result || !result.file_path) {
                    ctx.warn(`[render-dispatcher] ${task.id} 渲染失败`);
                    return { id: task.id, ok: false as const };
                }

                store.saveRenderResult(result);
                ctx.info(`[render-dispatcher] ${task.id} 渲染完成：${result.file_path}`);
                return { id: task.id, ok: true as const };
            },
            { concurrency: 3 },
        );

        for (const r of results) {
            if (r.ok) succeeded++;
            else failed++;
        }
    }

    ctx.info(`[render-dispatcher] 全部渲染完成，成功 ${succeeded}，失败 ${failed}`);
    return { succeeded, failed };
}

/**
 * 替换提示词中的依赖占位符 @{entity_name} 为实际图片路径。
 */
function resolveDependencyPlaceholders(
    ctx: IRunnerContext,
    prompt: string,
    dependencies: string[],
    store: RefImgStorage,
): string {
    let resolved = prompt;

    for (const depId of dependencies) {
        const result = store.getRenderResult(depId);
        if (!result || !result.file_path) {
            ctx.warn(`[resolve-deps] 依赖 ${depId} 未渲染成功，保持占位符`);
            continue;
        }

        const placeholder = `@{${depId}}`;
        resolved = resolved.replaceAll(placeholder, result.file_path);
    }

    return resolved;
}