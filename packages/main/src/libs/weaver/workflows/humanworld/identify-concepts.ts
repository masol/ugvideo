/**
 * weaver · 阶段 ③ identify-concepts
 */

import { getSmartModel } from '$libs/model/balancer/get-smart-model.js';
import { generateText } from 'ai';
import { randomUUID } from 'node:crypto';
import type { AlignedKind, Artifact, HumanFlow, HumanNode } from '../../shared/types.js';
import type { WeaveContext } from '../../shared/weave-context.js';

const ARTIFACT_IDENTIFY_INSTRUCTIONS = `你是 artifact 识别专家。给定节点列表，识别每个节点的输入/输出 artifact 名。

## 输出格式（markdown）

**节点 {nodeName}**
- 输入 artifact：{name1}, {name2}, ...
- 输出 artifact：{name3}

只输出识别结果。`;

const ACTION_ALIGN_INSTRUCTIONS = `你是动作对齐专家。给定节点的动作描述，判断它属于哪种执行器类型：

- kv-read：读取已存储的数据
- kv-write：写入数据到存储
- tool-call：调用外部工具/MCP
- llm-call：调用 LLM 进行总结/改写/翻译/分析
- prompt-user：询问用户/让用户确认

## 输出格式（markdown）

**节点 {nodeName}**
- 类型：{kv-read | kv-write | tool-call | llm-call | prompt-user}
- 工具名（如适用）：{toolName}
- 原因：{一句话}

只输出对齐结果。`;

export async function identifyConcepts(
    ctx: WeaveContext,
    flows: HumanFlow[],
): Promise<{ ok: boolean }> {
    const model = getSmartModel(undefined, ctx.ctx);

    for (const flow of flows) {
        const nodes = ctx.conceptTable.listFlowNodes()
            .filter(n => flow.g.hasNode(n.id)) as HumanNode[];

        if (nodes.length === 0) continue;

        await enrichArtifactSemantics(ctx, nodes, model);
        await alignActions(ctx, nodes, model);
        await deduplicateConcepts(ctx);
    }

    return { ok: true };
}

async function enrichArtifactSemantics(
    ctx: WeaveContext,
    nodes: HumanNode[],
    model: Awaited<ReturnType<typeof getSmartModel>>,
): Promise<void> {
    const nodeListText = nodes.map(n => `- ${n.name}: ${n.intent}`).join('\n');

    const { text } = await generateText({
        model,
        instructions: ARTIFACT_IDENTIFY_INSTRUCTIONS,
        prompt: `## 节点列表：\n${nodeListText}`,
    });

    const regex = /\*\*节点\s+([^*]+)\*\*\s*\n\s*- 输入 artifact[：:]\s*([^\n]+)\s*\n\s*- 输出 artifact[：:]\s*([^\n]+)/g;
    let m: RegExpExecArray | null;
    while ((m = regex.exec(text)) !== null) {
        const nodeName = m[1].trim();
        const inputNames = m[2].split(/[、,，]/).map(s => s.trim()).filter(Boolean);
        const outputName = m[3].trim();

        const node = nodes.find(n => n.name === nodeName);
        if (!node) continue;

        for (const inputName of inputNames) {
            const existing = ctx.conceptTable.getByName(inputName);
            if (!existing) {
                const id = randomUUID();
                ctx.conceptTable.register({
                    kind: 'artifact',
                    id,
                    name: inputName,
                    aliases: [],
                    intent: 'identified by LLM',
                    inferred: true,
                    validatorIds: [],
                    shape: 'scalar',
                    semanticFields: [],
                    dataSchema: null,
                } as Artifact);
                node.inputs.push(id);
            } else {
                if (!node.inputs.includes(existing.id)) {
                    node.inputs.push(existing.id);
                }
            }
        }

        const existingOut = ctx.conceptTable.getByName(outputName);
        if (!existingOut) {
            const id = randomUUID();
            const artifact: Artifact = {
                kind: 'artifact',
                id,
                name: outputName,
                aliases: [],
                intent: 'identified by LLM',
                inferred: true,
                validatorIds: [],
                shape: 'scalar',
                semanticFields: [],
                dataSchema: null,
            }
            ctx.conceptTable.register(artifact);
            node.outputs = [id];
        } else {
            node.outputs = [existingOut.id];
        }
    }
}

async function alignActions(
    ctx: WeaveContext,
    nodes: HumanNode[],
    model: Awaited<ReturnType<typeof getSmartModel>>,
): Promise<void> {
    const nodeListText = nodes.map(n => `- ${n.name}: ${n.intent}`).join('\n');

    const { text } = await generateText({
        model,
        instructions: ACTION_ALIGN_INSTRUCTIONS,
        prompt: `## 节点列表：\n${nodeListText}`,
    });

    const regex = /\*\*节点\s+([^*]+)\*\*\s*\n\s*- 类型[：:]\s*(kv-read|kv-write|tool-call|llm-call|prompt-user)\s*\n(?:- 工具名[：:]\s*([^\n]+)\s*\n)?- 原因[：:]\s*([^\n]+)/g;
    let m: RegExpExecArray | null;
    while ((m = regex.exec(text)) !== null) {
        const nodeName = m[1].trim();
        const kind = m[2].trim() as AlignedKind;
        const toolName = m[3]?.trim() || null;
        // const reason = m[4].trim();

        const node = nodes.find(n => n.name === nodeName);
        if (!node) continue;

        let toolId: string | null = null;
        let missingToolWarning: string | null = null;
        if (kind === 'tool-call' && toolName) {
            const tools = await ctx.kb.searchTool(toolName, 1);
            if (tools.length > 0 && tools[0].score < 0.3) {
                toolId = tools[0].item.id;
            } else {
                missingToolWarning = `节点「${nodeName}」需要 MCP 工具「${toolName}」，但未在 KB 中找到。请安装该工具后重试。`;
                ctx.warn(missingToolWarning);
            }
        }

        node.aligned = {
            kind,
            toolId,
            signature: `${node.name}:${kind}`,
            missingToolWarning,
        };
    }
}

async function deduplicateConcepts(ctx: WeaveContext): Promise<void> {
    const artifacts = ctx.conceptTable.listArtifacts();
    for (const artifact of artifacts) {
        const feature = `${artifact.name} | ${artifact.intent}`;
        const canonicalId = await ctx.kb.searchConceptDedupe(feature);

        if (canonicalId && canonicalId !== artifact.id) {
            const canonical = ctx.conceptTable.get(canonicalId);
            if (canonical && canonical.kind === 'artifact') {
                if (!canonical.aliases.includes(artifact.name)) {
                    canonical.aliases.push(artifact.name);
                }
                redirectArtifactReferences(ctx, artifact.id, canonicalId);
                ctx.conceptTable.unregister(artifact.id);
            }
        } else {
            ctx.kb.injectConceptDedupeEntry(feature, artifact.id);
        }
    }
}

function redirectArtifactReferences(
    ctx: WeaveContext,
    oldId: string,
    newId: string,
): void {
    const nodes = ctx.conceptTable.listFlowNodes();
    for (const node of nodes) {
        node.inputs = node.inputs.map(id => id === oldId ? newId : id);
        node.outputs = node.outputs.map(id => id === oldId ? newId : id);
    }
}