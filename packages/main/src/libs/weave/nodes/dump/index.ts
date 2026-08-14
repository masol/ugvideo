/**
 * weaver · node ⑤ dump
 *
 * 职责：导出主工作流的最终 Resolved Agent IR 为单一 markdown，供人类阅读
 *       与下一阶段（codegen）使用。
 *
 * 当前不做 codegen——只 dump。
 */

import type { WeaveContext } from "../../context.js";

export async function dumpWorkflow(ctx: WeaveContext): Promise<void> {
    void (ctx)
}
