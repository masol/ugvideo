/**
 * weaver · 工作流主入口
 *
 * 三阶段编排：
 *   ① parse           (targetStep >= 1)
 *   ② emit-formal-doc  (targetStep >= 2)
 * ③ emit-standard-doc (targetStep >= 3)
 */

import { PrjDB } from "$libs/project/controllers/drizzle/index.js";
import type { IRunnerContext } from "$types/blueprint/context.js";
import { getErrorMessage } from "radashi";
import { createWeaveContext } from "./context.js";
import { parseWorkflow } from "./nodes/parse/index.js";


/** 阶段编号常量 */
const WeaveStep = {
    Parse: 1,
    FormalDoc: 2,
    StandardDoc: 3,
} as const;

/**
 * target 解析：将 "N/M" 形式转为数字步骤（1-based）。
 * 缺省或非法 → Infinity（执行到底）。
 */
function parseTargetStep(raw: string | null | undefined): number {
    if (!raw) return Infinity;
    const m = raw.trim().match(/^(\d+)\/(\d+)$/);
    if (!m) return Infinity;
    const x = parseInt(m[1], 10);
    const y = parseInt(m[2], 10);
    if (x < 1 || x > y) return Infinity;
    return x;
}

export async function run(ctx: IRunnerContext): Promise<void> {
    const weaveCtx = createWeaveContext(ctx);
    weaveCtx.ctx.notify("weaver", "开始编译");

    const prjdb = PrjDB.ensure(ctx.prj);
    const targetStep = parseTargetStep(prjdb.get<string>("target"));

    try {
        // ① parse
        await parseWorkflow(weaveCtx);
        const flows = weaveCtx.conceptManager.listHumanFlows();
        if (targetStep <= WeaveStep.Parse) {
            ctx.notify('weaver 完成（target=parse）', `共 ${flows.length} 个工作流`);
            return;
        }
        weaveCtx.ctx.notify(
            "weaver 完成",
            `共 ${flows.length} 个工作流，${weaveCtx.conceptCount} 个概念`,
        );

        // @TODO: 这里开始经human-workflow编译为agent-workflow(agent-workflow是编译过程的intermediate)
        // await compile(weaveCtx);
        // if (targetStep <= WeaveStep.Parse) {
        //     weaveCtx.notify('weaver 完成（target=parse）', `共 ${flows.length} 个工作流`);
        //     return;
        // }


        // @TODO: 开始将agent-workflow编译为代码。
        // await generate(weaveCtx);
        // if (targetStep <= WeaveStep.Parse) {
        //     weaveCtx.notify('weaver 完成（target=parse）', `共 ${flows.length} 个工作流`);
        //     return;
        // }

        // @TOD: 开始将编译后的代码导出为项目类型。
        // await dump(weaveCtx);

    } catch (err) {
        weaveCtx.ctx.notify("weaver 失败", getErrorMessage(err));
        throw err;
    }
}

export async function compile(ctx: IRunnerContext): Promise<void> {
    return run(ctx);
}