/**
 * weaver · 阶段 ⑥ extract-io
 */

import { getSmartModel } from '$libs/model/balancer/get-smart-model.js';
import { generateText } from 'ai';
import { randomUUID } from 'node:crypto';
import { topoOrder } from '../../shared/graph/graph-ops.js';
import type { Artifact, HumanFlow, HumanNode } from '../../shared/types.js';
import type { WeaveContext } from '../../shared/weave-context.js';

const EXTRACT_IO_INSTRUCTIONS = `你是 IO 提取专家。给定节点的 actionAtom 和上游已产出的 artifact 名清单，确定本节点的输入/输出。

## 关键规则
- **优先复用上游已产出的 artifact 名**——不要另造新词
- 每个节点恰好 1 个输出（除非明确多输出）
- 如果需要新 artifact（上游没有），在 description 中说明

## 输出格式（markdown）

**节点 {name}**
- inputs: {artifactName1}, {artifactName2}
- outputs: {artifactName3}
- new_artifacts: {如果需要新 artifact，列出 name + intent}

只输出 IO 提取结果。`;

export async function extractIO(
    ctx: WeaveContext,
    flows: HumanFlow[],
): Promise<{ ok: boolean }> {
    const model = getSmartModel(undefined, ctx.ctx);

    for (const flow of flows) {
        const order = topoOrder(flow.g);
        const producedSoFar = new Set<string>();

        for (const ext of ctx.compiled.getExternalInputs(flow.id)) {
            producedSoFar.add(ext.name);
        }

        for (const nodeId of order) {
            const node = ctx.conceptTable.get(nodeId);
            if (!node || (node.kind !== 'flow-node' && node.kind !== 'human')) continue;
            const humanNode = node as HumanNode;

            const upstreamNames = [...producedSoFar].join(', ');

            const { text } = await generateText({
                model,
                instructions: EXTRACT_IO_INSTRUCTIONS,
                prompt: `## 节点：\n${humanNode.name}\n${humanNode.actionAtom}\n\n## 上游已产出 artifact：\n${upstreamNames}`,
            });

            const regex = /\*\*节点\s+([^*]+)\*\*\s*\n\s*- inputs[：:]\s*([^\n]+)\s*\n\s*- outputs[：:]\s*([^\n]+)(?:\s*\n\s*- new_artifacts[：:]\s*([^\n]+))?/g;
            const m = regex.exec(text);
            if (!m) continue;

            const inputNames = m[2].split(/[、,，]/).map(s => s.trim()).filter(Boolean);
            const outputName = m[3].trim();

            humanNode.inputs = inputNames.map(name => {
                const existing = ctx.conceptTable.getByName(name);
                if (existing) return existing.id;
                const id = randomUUID();
                ctx.conceptTable.register({
                    kind: 'artifact',
                    id,
                    name,
                    aliases: [],
                    intent: `extracted for ${humanNode.name}`,
                    inferred: true,
                    validatorIds: [],
                    shape: 'scalar',
                    semanticFields: [],
                    dataSchema: null,
                } as Artifact);
                return id;
            });

            const existingOut = ctx.conceptTable.getByName(outputName);
            if (existingOut) {
                humanNode.outputs = [existingOut.id];
            } else {
                const id = randomUUID();
                ctx.conceptTable.register({
                    kind: 'artifact',
                    id,
                    name: outputName,
                    aliases: [],
                    intent: `extracted for ${humanNode.name}`,
                    inferred: true,
                    validatorIds: [],
                    shape: 'scalar',
                    semanticFields: [],
                    dataSchema: null,
                } as Artifact);
                humanNode.outputs = [id];
            }

            for (const outputId of humanNode.outputs) {
                const artifact = ctx.conceptTable.get(outputId);
                if (artifact && artifact.kind === 'artifact') {
                    producedSoFar.add(artifact.name);
                }
            }
        }
    }

    return { ok: true };
}