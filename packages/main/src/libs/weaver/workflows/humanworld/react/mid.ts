/**
 * weaver · 中层 reAct
 */

import type { HumanFlow } from '../../../shared/types.js';
import type { WeaveContext } from '../../../shared/weave-context.js';
import { emitFormalDoc } from '../emit-formal-doc.js';
import { extractIO } from '../extract-io.js';
import { formalizeHumanFlow } from '../formalize.js';
import { identifyConcepts } from '../identify-concepts.js';
import { identifyConstraints } from '../identify-constraints.js';
import { parsePipelines } from '../parse.js';
import { splitCompoundActions } from '../split-actions.js';
import { validateHumanFlows } from '../validate.js';

const MAX_ROUNDS = 4;

export async function runMidLayer(
    ctx: WeaveContext,
    initialFeedback?: string,
): Promise<HumanFlow[]> {
    let feedback: string | undefined = initialFeedback;

    for (let round = 1; round <= MAX_ROUNDS; round++) {
        ctx.notify('中层 reAct', `第 ${round} 轮开始${feedback ? '（含反馈）' : ''}`);

        const flows = await parsePipelines(ctx, feedback);
        if (flows.length === 0) {
            feedback = 'parse 阶段无产出，请检查输入文档';
            continue;
        }

        await splitCompoundActions(ctx, flows);

        const conceptResult = await identifyConcepts(ctx, flows);
        if (!conceptResult.ok) continue;

        const constraintResult = await identifyConstraints(ctx, flows);
        if (!constraintResult.ok) continue;

        const formalizeResult = await formalizeHumanFlow(ctx, flows, feedback);
        if (!formalizeResult.ok) continue;

        const ioResult = await extractIO(ctx, flows);
        if (!ioResult.ok) continue;

        const validationResult = await validateHumanFlows(ctx, flows);
        if (validationResult.ok) {
            const doc = await emitFormalDoc(ctx, flows);
            for (const flow of flows) {
                flow.formalDoc = doc;
            }
            return flows;
        }

        feedback = validationResult.feedback;
        ctx.warn(`[mid-react] 第 ${round} 轮校验失败：\n${feedback?.substring(0, 200)}`);
    }

    throw new Error(`[mid-react] ${MAX_ROUNDS} 轮未收敛`);
}