/**
 * weaver · 外层 reAct
 */

import type { HumanFlow } from '../../../shared/types.js';
import type { WeaveContext } from '../../../shared/weave-context.js';
import { runMidLayer } from './mid.js';

const MAX_ROUNDS = 4;

export async function runOuterReact(ctx: WeaveContext): Promise<HumanFlow[]> {
    let feedback: string | undefined;

    for (let round = 1; round <= MAX_ROUNDS; round++) {
        ctx.reactRound = round;

        const flows = await runMidLayer(ctx, feedback);

        const crossErrors = validateCrossGraph(flows, ctx);
        if (crossErrors.length === 0) {
            return flows;
        }

        feedback = crossErrors.join('\n');
        ctx.warn(`[outer-react] 第 ${round} 轮跨图校验失败：\n${feedback}`);
    }

    throw new Error(`[outer-react] ${MAX_ROUNDS} 轮未收敛`);
}

function validateCrossGraph(
    flows: HumanFlow[],
    ctx: WeaveContext,
): string[] {
    const errors: string[] = [];

    const nameCount = new Map<string, number>();
    for (const flow of flows) {
        nameCount.set(flow.name, (nameCount.get(flow.name) ?? 0) + 1);
    }
    for (const [name, count] of nameCount) {
        if (count > 1) {
            errors.push(`工作流名称重复：「${name}」出现 ${count} 次`);
        }
    }

    const flowById = new Map(flows.map(f => [f.id, f]));
    for (const flow of flows) {
        const nodes = ctx.conceptTable.listFlowNodes().filter(n => flow.g.hasNode(n.id));
        for (const node of nodes) {
            for (const edge of node.externalEdges) {
                if (edge.kind === 'external') {
                    const target = flowById.get(edge.targetGraphId);
                    if (!target) {
                        errors.push(`节点「${node.name}」的外部边引用了不存在的图「${edge.targetGraphId}」`);
                    } else if (!target.g.hasNode(edge.targetNodeId)) {
                        errors.push(`节点「${node.name}」的外部边引用了图「${edge.targetGraphId}」中不存在的节点「${edge.targetNodeId}」`);
                    }
                }
            }
        }
    }

    return errors;
}