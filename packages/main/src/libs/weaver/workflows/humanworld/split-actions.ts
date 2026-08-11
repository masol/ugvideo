/**
 * weaver · 阶段 ② split-compound-actions
 */

import { getSmartModel } from '$libs/model/balancer/get-smart-model.js';
import { generateText } from 'ai';
import { randomUUID } from 'node:crypto';
import type { HumanFlow, HumanNode } from '../../shared/types.js';
import type { WeaveContext } from '../../shared/weave-context.js';

const SPLIT_INSTRUCTIONS = `你是动作拆解专家。给定一个工作流步骤（可能包含多个动作），拆解到最小动作原子。

## 你的产物（必须是 markdown 分节）

**动作 1：{原子动作描述}**
- 输入：{这个动作需要什么}
- 输出：{这个动作产生什么}

**动作 2：{原子动作描述}**
- 输入：...
- 输出：...

【关键规则】
- 每个原子动作必须是"一节点 = 一动作"——不能包含"和"、"然后"、"接着"等复合连接词
- 原子动作必须可以独立执行
- 拆解后所有原子动作的文本拼接应大致等于原步骤文本

只输出原子动作列表，不要输出其他内容。`;

export async function splitCompoundActions(
    ctx: WeaveContext,
    flows: HumanFlow[],
): Promise<void> {
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

            const newNodeIds: string[] = [];
            const firstArtifactId = node.inputs[0];
            const lastArtifactId = node.outputs[0];

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
                    intent: atom.action,
                    inferred: false,
                    validatorIds: [],
                    actionAtom: atom.action,
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
    }
}

interface AtomAction {
    name: string;
    action: string;
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
            action: m[2].trim(),
            input: m[3].trim(),
            output: m[4].trim(),
        });
    }
    return atoms;
}