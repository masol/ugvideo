// nodes/generate-reference-images/render/render-types.ts
import type { IRunnerContext } from "$types/blueprint/context.js";
import type { RenderResult, RenderTask } from "../types.js";

/** 渲染函数签名 */
export type RenderFn = (
    ctx: IRunnerContext,
    task: RenderTask,
) => Promise<RenderResult | null>;