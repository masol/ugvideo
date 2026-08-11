/**
 * weaver · compile 工作流入口
 */

import { createWeaveContext } from '$libs/weaver/shared/weave-context.js';
import { runOuterReact } from '$libs/weaver/workflows/humanworld/react/outer.js';
import type { IRunnerContext } from '$types/blueprint/context.js';

export async function compile(ctx: IRunnerContext): Promise<void> {
    const weaveCtx = createWeaveContext(ctx);

    weaveCtx.notify('compile', '开始编译工作流');

    try {
        const flows = await runOuterReact(weaveCtx);

        for (const flow of flows) {
            weaveCtx.storage.saveHumanFlow(flow);
        }

        weaveCtx.storage.saveConceptTable(weaveCtx.conceptTable.toJSON());
        weaveCtx.storage.saveInferences(weaveCtx.compiled.getInferences());

        weaveCtx.notify('compile 完成', `共 ${flows.length} 个工作流，${weaveCtx.conceptTable.count()} 个概念`);
    } catch (err) {
        weaveCtx.notify('compile 失败', (err as Error).message);
        throw err;
    }
}