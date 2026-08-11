/**
 * weaver · 阶段 ⑦ validate-humanflow
 */

import { errorsToString, validateHumanFlow } from '$libs/weaver/shared/graph/validate.js';
import type { HumanFlow } from '$libs/weaver/shared/types.js';
import type { WeaveContext } from '$libs/weaver/shared/weave-context.js';

export async function validateHumanFlows(
    ctx: WeaveContext,
    flows: HumanFlow[],
): Promise<{ ok: boolean; feedback?: string }> {
    const allErrors: { flowId: string; errors: string }[] = [];

    for (const flow of flows) {
        const errors = validateHumanFlow(flow, ctx.conceptTable, ctx.compiled);
        if (errors.length > 0) {
            allErrors.push({
                flowId: flow.id,
                errors: errorsToString(errors),
            });
        }
    }

    if (allErrors.length === 0) {
        return { ok: true };
    }

    return {
        ok: false,
        feedback: allErrors.map(e => `## 工作流 ${e.flowId.slice(0, 8)}：\n${e.errors}`).join('\n\n'),
    };
}