// nodes/generate-reference-images/render/default-renderer.ts
import type { IRunnerContext } from "$types/blueprint/context.js";
import type { RenderResult, RenderTask } from "../types.js";

/**
 * 默认渲染器（占位）。
 * 参考图/环境图都是"从零生成"的独立图，因此这里是纯文生图（text-to-image）。
 * 场景镜头图（多图 I2I）由下游节点处理。
 */
export async function defaultRender(
    ctx: IRunnerContext,
    task: RenderTask,
): Promise<RenderResult | null> {
    ctx.debug(`[renderer] task=${task.id} type=${task.type}`);
    ctx.debug(`[renderer] prompt (first 300 chars):\n${task.prompt.slice(0, 300)}${task.prompt.length > 300 ? "\n..." : ""}`);

    if (task.asset_info) {
        ctx.debug(`[renderer] asset: name=${task.asset_info.entity_name} kind=${task.asset_info.kind} layout=${task.asset_info.layout}`);
    }
    if (task.scene_info) {
        ctx.debug(`[renderer] scene: ${task.scene_info.scene_id}, inline entities=${task.scene_info.inline_entities.length}`);
    }

    // TODO: 用户实现文生图 API 调用
    // const filePath = await callImageAPI(task.prompt, { width: 1920, height: 1080 });
    // if (!filePath) return null;
    // return { id: task.id, file_path: filePath };

    return null;
}