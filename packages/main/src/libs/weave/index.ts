/**
 * weaver · 工作流主入口
 */

import { PrjDB } from '$libs/project/controllers/drizzle/index.js';
import type { IRunnerContext } from '$types/blueprint/context.js';
import { createWeaveContext } from './context.js';
import { emitFormalDoc } from './nodes/emit-formal-doc/index.js';
import { emitStandardDoc } from './nodes/emit-standard-doc/index.js';
import { parseWorkflow } from './nodes/parse/index.js';
import { parseWeaveTarget, WeaveTargetOrder } from './types.js';

export async function run(ctx: IRunnerContext): Promise<void> {
    const weaveCtx = createWeaveContext(ctx);
    weaveCtx.notify('weaver', '开始编译');

    const prjdb = PrjDB.ensure(ctx.prj);
    const target = parseWeaveTarget(prjdb.get<string>('target'));
    const targetOrder = target ? WeaveTargetOrder[target] : WeaveTargetOrder.full;

    try {
        // 阶段 1：解析（标准格式 / LLM 路径统一入口）
        const flows = await parseWorkflow(weaveCtx);

        // 落盘 HumanFlow
        for (const flow of flows) {
            weaveCtx.storage.workflow.saveHumanFlow(flow);
        }
        weaveCtx.storage.concept.saveConceptTable(weaveCtx.conceptTable.toJSON());

        if (targetOrder <= WeaveTargetOrder.parse) {
            weaveCtx.notify('weaver 完成（target=parse）', `共 ${flows.length} 个工作流`);
            return;
        }

        // 阶段 2：形式化文档
        const formalDoc = await emitFormalDoc(weaveCtx, flows);
        for (const flow of flows) flow.formalDoc = formalDoc;
        weaveCtx.storage.workflow.saveFormalDoc(flows[0]?.id ?? 'all', formalDoc);

        if (targetOrder <= WeaveTargetOrder.formalDoc) {
            weaveCtx.notify('weaver 完成（target=formalDoc）', `共 ${flows.length} 个工作流`);
            return;
        }

        // 阶段 3：标准格式 markdown
        const standardDoc = emitStandardDoc(weaveCtx, flows);
        weaveCtx.storage.workflow.saveStandardDoc(standardDoc);

        weaveCtx.notify('weaver 完成', `共 ${flows.length} 个工作流，${weaveCtx.conceptTable.count()} 个概念`);
    } catch (err) {
        weaveCtx.notify('weaver 失败', (err as Error).message);
        throw err;
    }
}

export async function compile(ctx: IRunnerContext): Promise<void> {
    return run(ctx);
}