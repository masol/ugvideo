/**
 * weaver · 阶段 ④ split-actions
 *
 * 仅对非标准格式下的多动作步骤做原子化拆解。
 * 标准格式下步骤已是原子，直接跳过。
 */

import { getSmartModel } from '$libs/model/balancer/get-smart-model.js';
import { generateText } from 'ai';
import { randomUUID } from 'node:crypto';
import type { HumanFlow, HumanNode } from '../../shared/types.js';
import type { WeaveContext } from '../../shared/weave-context.js';

const SPLIT_INSTRUCTIONS = `你是动作拆解专家。给定一个步骤（含多个动作），拆解为原子动作。

## 你的产物（markdown）

**动作 1：{原子动作}**
- 输入：...
- 输出：...

【规则】
- 每个原子动作必须是"一节点 = 一动作"——不能包含"和""然后""接着"
- 原子动作可独立执行
- 拆解后所有原子的文本拼接应大致等于原步骤

只输出原子动作列表。`;

export async function splitCompoundActions(
    ctx: WeaveContext,
    flows: HumanFlow[],
    isStandard: boolean,
): Promise<void> {
    if (isStandard) return; // 标准格式下步骤已是原子

    const model = getSmartModel(undefined, ctx.ctx);

    for (const flow of flows) {
        const nodes = ctx.conceptTable.listFlowNodes()
            .filter(n => flow.g.hasNode(n.id)) as HumanNode[];

        for (const node of nodes) {
            const { text } = await generateText({
                model,
                instructions: SPLIT_INSTRUCTIONS,
                prompt: `## 步骤：\n${node.name}\n${node.intent}`,
            });

            const atoms = parseAtomsFromMarkdown(text);
            if (atoms.length <= 1) continue;

            applySplit(ctx, flow, node, atoms);
        }
    }

    ctx.storage.saveAtomActions('split completed');
}

interface AtomAction {
    name: string;
    input: string;
    output: string;
}

function parseAtomsFromMarkdown(markdown: string): AtomAction[] {
    const atoms: AtomAction[] = [];
    const regex = /\*\*动作\s+(\d+)[：:]\s*([^*]+)\*\*\s*\n\s*- 输入[：:]\s*([^\n]+)\s*\n\s*- 输出[：:]\s*([^\n]+)/g;
    let m: RegExpExecArray | null;
    while ((m = regex.exec(markdown)) !== null) {
        atoms.push({
            name: m[2].trim(),
            input: m[3].trim(),
            output: m[4].trim(),
        });
    }
    return atoms;
}

function applySplit(
    ctx: WeaveContext,
    flow: HumanFlow,
    node: HumanNode,
    atoms: AtomAction[],
): void {
    const firstArtifactId = node.inputs[0];
    const lastArtifactId = node.outputs[0];
    const newNodeIds: string[] = [];

    let prevId: string | null = null;
    let prevArtifactId: string | null = null;

    for (let i = 0; i < atoms.length; i++) {
        const atom = atoms[i];
        const newNodeId = randomUUID();
        newNodeIds.push(newNodeId);

        const thisOutputId = i === atoms.length - 1
            ? lastArtifactId
            : randomUUID();

        const newNode: HumanNode = {
            kind: 'human',
            id: newNodeId,
            name: atom.name,
            aliases: [],
            intent: atom.input + ' → ' + atom.output,
            inferred: false,
            validatorIds: [],
            actionAtom: atom.name,
            inputs: i === 0 ? [firstArtifactId] : [prevArtifactId!],
            outputs: [thisOutputId],
            aligned: null,
            externalEdges: [],
        };

        ctx.conceptTable.register(newNode);
        flow.g.addNode(newNodeId, { nodeId: newNodeId });

        if (prevId) {
            flow.g.addEdge(prevId, newNodeId, {});
        }
        prevId = newNodeId;
        prevArtifactId = thisOutputId;
    }

    const inNeighbors = flow.g.inNeighbors(node.id);
    const outNeighbors = flow.g.outNeighbors(node.id);
    flow.g.dropNode(node.id);
    ctx.conceptTable.unregister(node.id);

    for (const inN of inNeighbors) {
        flow.g.addEdge(inN, newNodeIds[0], {});
    }
    for (const outN of outNeighbors) {
        flow.g.addEdge(newNodeIds[newNodeIds.length - 1], outN, {});
    }

    ctx.compiled.addInference({
        kind: 'added-node',
        target: flow.id,
        note: `节点「${node.name}」拆解为 ${atoms.length} 个原子动作`,
        nearestOriginRef: node.originRef ?? { sourceText: node.intent, paragraphRange: [0, 0] },
    });
}