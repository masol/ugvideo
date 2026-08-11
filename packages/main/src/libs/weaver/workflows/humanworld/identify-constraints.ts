/**
 * weaver · 阶段 ④ identify-constraints
 */

import { getSmartModel } from '$libs/model/balancer/get-smart-model.js';
import { generateText } from 'ai';
import { randomUUID } from 'node:crypto';
import { topoOrder } from '../../shared/graph/graph-ops.js';
import type { Constraint, HumanFlow, HumanNode } from '../../shared/types.js';
import type { WeaveContext } from '../../shared/weave-context.js';

const CONSTRAINT_EXTRACT_INSTRUCTIONS = `你是约束抽取专家。给定工作流文档和节点列表，从文档中**显式出现的**约束描述中抽取约束。

## 关键规则
- **禁发明**：只抽取文档中显式出现的约束，禁止"补充"或"推断"
- description 必须是文档原话或近似引用
- 每条约束形如"X 必须是 Y"、"X 不能是 Z"、"X 必须满足关系 Y"

## 输出格式（markdown）

**约束 {N}：{description}**
- 涉及概念：{conceptName1}, {conceptName2}
- 关系类型：equals | subset-of | references | freshness>= | unique-by

只输出约束列表。`;

export async function identifyConstraints(
    ctx: WeaveContext,
    flows: HumanFlow[],
): Promise<{ ok: boolean }> {
    const model = getSmartModel(undefined, ctx.ctx);

    for (const flow of flows) {
        await closeExternalInputs(ctx, flow);
        await extractConstraints(ctx, flow, model);
    }

    return { ok: true };
}

async function closeExternalInputs(
    ctx: WeaveContext,
    flow: HumanFlow,
): Promise<void> {
    const order = topoOrder(flow.g);
    const upstreamOutputs = new Set<string>();
    const externalInputs: { name: string; consumedBy: string }[] = [];

    for (const nodeId of order) {
        const node = ctx.conceptTable.get(nodeId);
        if (!node || (node.kind !== 'flow-node' && node.kind !== 'human')) continue;

        const humanNode = node as HumanNode;

        for (const inputId of humanNode.inputs) {
            if (!upstreamOutputs.has(inputId)) {
                const artifact = ctx.conceptTable.get(inputId);
                if (artifact && artifact.kind === 'artifact') {
                    externalInputs.push({
                        name: artifact.name,
                        consumedBy: humanNode.id,
                    });
                }
            }
        }

        for (const outputId of humanNode.outputs) {
            upstreamOutputs.add(outputId);
        }
    }

    const uniqueInputs = new Map<string, { name: string; alias: string; providedBy: 'prompt-once' | 'file' | 'env'; consumedBy: string[]; graphId: string }>();
    for (const ext of externalInputs) {
        if (!uniqueInputs.has(ext.name)) {
            uniqueInputs.set(ext.name, {
                name: ext.name,
                alias: ext.name,
                providedBy: 'prompt-once',
                consumedBy: [ext.consumedBy],
                graphId: flow.id,
            });
        } else {
            uniqueInputs.get(ext.name)!.consumedBy.push(ext.consumedBy);
        }
    }

    ctx.compiled.setExternalInputs(flow.id, [...uniqueInputs.values()]);
}

async function extractConstraints(
    ctx: WeaveContext,
    flow: HumanFlow,
    model: Awaited<ReturnType<typeof getSmartModel>>,
): Promise<void> {
    const docText = ctx.userInputs.find(d => d.includes(flow.name)) ?? '';
    const nodes = ctx.conceptTable.listFlowNodes()
        .filter(n => flow.g.hasNode(n.id));
    const nodeListText = nodes.map(n => `- ${n.name}: ${n.intent}`).join('\n');

    const { text } = await generateText({
        model,
        instructions: CONSTRAINT_EXTRACT_INSTRUCTIONS,
        prompt: `## 工作流文档：\n${docText}\n\n## 节点列表：\n${nodeListText}`,
    });

    const regex = /\*\*约束\s+(\d+)[：:]\s*([^*]+)\*\*\s*\n\s*- 涉及概念[：:]\s*([^\n]+)\s*\n\s*- 关系类型[：:]\s*(equals|subset-of|references|freshness>=|unique-by)/g;
    let m: RegExpExecArray | null;
    while ((m = regex.exec(text)) !== null) {
        const description = m[2].trim();
        const conceptNames = m[3].split(/[、,，]/).map(s => s.trim()).filter(Boolean);
        const relation = m[4].trim() as Constraint['relation'];

        if (!docText.includes(description.substring(0, 20))) {
            ctx.warn(`[identify-constraints] 跳过未匹配原文的约束：${description.substring(0, 30)}`);
            continue;
        }

        const subjectName = conceptNames[0];
        const subject = ctx.conceptTable.getByName(subjectName);
        if (!subject) continue;

        const constraint: Constraint = {
            kind: 'constraint',
            id: randomUUID(),
            name: `约束：${description.substring(0, 30)}`,
            aliases: [],
            intent: description,
            inferred: false,
            validatorIds: [],
            actionAtom: `检查约束：${description}`,
            inputs: subject.validatorIds.length > 0 ? [subject.validatorIds[0]] : [],
            outputs: [],
            relation,
        };
        ctx.conceptTable.register(constraint);

        if (!subject.validatorIds.includes(constraint.id)) {
            subject.validatorIds.push(constraint.id);
        }
    }
}