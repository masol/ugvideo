/**
 * weaver · 阶段 ⑤ formalize-humanflow
 */

import { getSmartModel } from '$libs/model/balancer/get-smart-model.js';
import { generateText } from 'ai';
import { addEdge, addNode, createGraph } from '../../shared/graph/gdag.js';
import type { HumanFlow, HumanNode } from '../../shared/types.js';
import type { WeaveContext } from '../../shared/weave-context.js';

const FORMALIZE_INSTRUCTIONS = `你是工作流形式化专家。给定节点列表（含输入/输出 artifact），构建顺序流和条件分支。

## 你的产物（markdown）

**节点顺序流**：
- 步骤 1 → 步骤 2
- 步骤 2 → 步骤 3

**条件分支**：
- 步骤 2 如果 {condition} → 步骤 3
- 步骤 2 否则 → 步骤 5

**子流程引用**：
- 步骤 4 → 子流程：{subProcessName}（返回：是/否）

只输出形式化结果。`;

export async function formalizeHumanFlow(
    ctx: WeaveContext,
    flows: HumanFlow[],
    feedback?: string,
): Promise<{ ok: boolean }> {
    const model = getSmartModel(undefined, ctx.ctx);

    for (const flow of flows) {
        const nodes = ctx.conceptTable.listFlowNodes()
            .filter(n => flow.g.hasNode(n.id)) as HumanNode[];

        flow.g = createGraph();
        for (const node of nodes) {
            addNode(flow.g, node.id);
        }

        const nodeListText = nodes.map(n =>
            `- ${n.name} (${n.id.slice(0, 8)}): ${n.intent}`
        ).join('\n');

        const { text } = await generateText({
            model,
            instructions: FORMALIZE_INSTRUCTIONS,
            prompt: feedback
                ? `## 上一轮失败：\n${feedback}\n\n## 节点列表：\n${nodeListText}`
                : `## 节点列表：\n${nodeListText}`,
        });

        const seqRegex = /步骤\s+(\d+)\s*→\s*步骤\s+(\d+)/g;
        let m: RegExpExecArray | null;
        while ((m = seqRegex.exec(text)) !== null) {
            const fromOrder = parseInt(m[1], 10);
            const toOrder = parseInt(m[2], 10);
            const fromNode = nodes[fromOrder - 1];
            const toNode = nodes[toOrder - 1];
            if (fromNode && toNode) {
                addEdge(flow.g, fromNode.id, toNode.id, {});
            }
        }

        const condRegex = /步骤\s+(\d+)\s*如果\s*\{?([^}→\n]+)\}?\s*→\s*步骤\s+(\d+)/g;
        while ((m = condRegex.exec(text)) !== null) {
            const fromOrder = parseInt(m[1], 10);
            const conditionDesc = m[2].trim();
            const toOrder = parseInt(m[3], 10);
            const fromNode = nodes[fromOrder - 1];
            const toNode = nodes[toOrder - 1];
            if (fromNode && toNode) {
                fromNode.externalEdges.push({
                    kind: 'internal',
                    condition: conditionDesc,
                    target: toNode.id,
                });
            }
        }
    }

    return { ok: true };
}