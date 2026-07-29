// nodes/generate-reference-images/render/default-renderer.ts
import type { IRunnerContext } from "$types/blueprint/context.js";
import type { RenderResult, RenderTask } from "../types.js";

/**
 * 默认渲染器（占位）。
 * 用户需替换为实际图像生成 API 调用。
 *
 * 约定：
 * - 返回 RenderResult { id, file_path } 表示成功
 * - 返回 null 或 file_path 为空字符串表示渲染失败
 * - 调用前应 ctx.debug 输出关键信息
 */
export async function defaultRender(
    ctx: IRunnerContext,
    task: RenderTask,
): Promise<RenderResult | null> {
    ctx.debug(`[renderer] task=${task.id} type=${task.type}`);
    ctx.debug(`[renderer] prompt (first 1300 chars):\n${task.prompt.slice(0, 300)}${task.prompt.length > 1300 ? "\n..." : ""}`);

    if (task.asset_info) {
        ctx.debug(`[renderer] asset_info: name=${task.asset_info.entity_name} kind=${task.asset_info.kind} layout=${task.asset_info.layout}`);
        ctx.debug(`[renderer] base_description (first 1200 chars): ${task.asset_info.base_description.slice(0, 1200)}`);
    }

    if (task.scene_info) {
        ctx.debug(`[renderer] scene_info: scene_id=${task.scene_info.scene_id}`);
        ctx.debug(`[renderer] environment (first 1200 chars): ${task.scene_info.environment.slice(0, 1200)}`);
    }

    // TODO: 用户实现实际渲染逻辑
    // 示例：调用 Stable Diffusion / Midjourney / DALL-E API
    // const filePath = await callImageAPI(task.prompt, { width: 1920, height: 1080 });
    // if (!filePath) return null;
    // return { id: task.id, file_path: filePath };

    return null;
}