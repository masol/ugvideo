/**
 * weaver · node ③ decompose
 *
 * 职责：把每个 HumanNode 的 actionAtom（自然语言）编译为 Agent IR（指令序列）。
 *
 * 输出格式（markdown，每 FlowNode 一份）：
 *
 *   # Agent IR for <node_name>
 *
 *   ## Inputs
 *   `<name>` (artifact, ...)
 *   `<name>` (config)
 *
 *   ## Instructions
 *
 *   1. [parallel]
 *      - [invoke] summary on `<name>` → `<result_name>`
 *      - [invoke] extract-actions on `<name>` → `<result_name>`
 *
 *   2. [when] `<condition>`
 *      - [invoke] compress on `<name>` → `<result_name>`
 *      - [goto] 3
 *
 *   3. [then]
 *      - [compose] merge A + B → C
 *
 *   4. [await] human approval on `<name>`
 *
 *   ## Outputs
 *   `<name>` (artifact)
 *
 *仍产出自然语言 markdown，不要求结构化 JSON；后续节点按需解析。
 */

import { checkExpiry } from "$libs/blueprint/glossary/expiry.js";
import { getSmartModel } from "$libs/model/balancer/get-smart-model.js";
import { generateText } from "ai";
import type { WeaveContext } from "../../context.js";
import type { ArtifactRelation, HumanFlow, HumanNode } from "../../types.js";

const DECOMPOSE_INSTRUCTIONS = `你是 HumanNode → AgentIR 编译器。

任务：把单个工作流步骤（一个 HumanNode）的自然语言动作描述，编译为 Agent 虚拟机的指令序列（Agent IR）。指令是 markdown 文本，但语义必须严格、可无歧义执行。

## 指令类型清单（必须严格使用）

- [invoke] <verb> on \`<artifact_name>\` → \`<output_name>\`
  调用 LLM 或 skill 对某个 artifact 做某种处理，产生新 artifact。
  动词要准确表达动作（summary / extract-actions / translate / rewrite / classify /
  score / merge / split 等）。

- [compose] merge \`<a>\` + \`<b>\` + ... → \`<result>\`
  把多个 artifact 拼装成一个 artifact（保留 partOf/composedOf 关系）。

- [parallel]
  标记下一组指令并行执行。

- [when] \`<condition_expression>\`
  条件分支：条件为真时执行下一组指令，否则跳过。
  条件表达式用自然语言，但要可判定（如 "会议摘要长度 > 1000"、"提取的行动项数 == 0"）。

- [goto] <step_number>
  跳转到指定步骤号。

- [await] human approval on \`<artifact_name>\`
  等待人类对某个 artifact 的审批/确认。

- [then]
  串行执行下一条指令（可省略，默认即串行）。

##编译要求

1. **保留原 actionAtom 中的所有控制流与质量约束**——所有"若 X 则..."、"否则..."、
   "重复直到..."、"等待审批"必须原样反映为 [when] / [goto] / [await] 指令。
2. **动作中提及的每个产物（反引号包裹）必须出现在该步骤 inputs 或 outputs 中**；
   缺失则视为该步骤实际未声明，需在 Inputs段列出。
3. **Inputs 段可包含前置节点的输出与全局输入**——LLM 自行选择实际需要的。
4. **产物之间的语义关系（partOf / composedOf / arrayOf / refinedFrom）由   preprocess-artifacts 节点提供，编译时引用即可，无需重新推导**。
5. **每个 invoke 必须明确产出 artifact 名**（→ \`<output_name>\`）。
6. **指令步骤号从 1 开始连续编号**；[goto] 引用这些编号。

## 输出格式

严格按以下 markdown 结构输出（不要多余内容）：

\`\`\`markdown
# Agent IR for <步骤名>

## Inputs
- \`<name>\` (artifact, refined from \`<parent>\`)
- \`<name>\` (config, default: ...)
...

## Instructions

1. [parallel]
   - [invoke] <verb> on \`<input>\` → \`<output>\`
   - [invoke] <verb> on \`<input>\` → \`<output>\`

2. [when] \`<condition>\`
   - [invoke] <verb> on \`<input>\` → \`<output>\`
   - [goto] 4

3. [then]
   - [compose] merge \`<a>\` + \`<b>\` → \`<c>\`

4. [await] human approval on \`<output>\`

## Outputs
- \`<name>\` (artifact, composed of \`<x>\`, \`<y>\`)
\`\`\`

禁止输出任何"以下是编译结果"之类的元信息。`;

export async function decomposeWorkflow(ctx: WeaveContext): Promise<void> {
    const store = ctx.storage.workflow;

    if (!checkExpiry(ctx.ctx, {
        inputKeys: store.latestKey("artifact_relations"),
        outputKeys: store.latestKey("agent_ir_index"),
    })) {
        ctx.ctx.info("[decomposeWorkflow] 输出仍新鲜，跳过");
        return;
    }

    const mainFlow = findMainFlow(ctx);
    if (!mainFlow) {
        ctx.ctx.notify("decompose", "无主工作流，跳过");
        return;
    }

    const relations = store.getArtifactRelations() ?? {};
    const nodes = mainFlow.g.nodes()
        .map((id) => ctx.conceptManager.nodes.get(id))
        .filter((n): n is HumanNode => n !== null);

    const results = await Promise.all(
        nodes.map((node) => decomposeNode(ctx, mainFlow, node, relations)),
    );

    const nodeIds = nodes.map((n) => n.id);
    for (let i = 0; i < nodes.length; i++) {
        store.saveAgentIR(nodes[i].id, results[i]);
    }
    store.saveAgentIRIndex(nodeIds);

    ctx.ctx.notify("decompose 完成", `${nodes.length} 个步骤已编译为 Agent IR`);
}

async function decomposeNode(
    ctx: WeaveContext,
    flow: HumanFlow,
    node: HumanNode,
    relations: Record<string, ArtifactRelation>,
): Promise<string> {
    const store = ctx.storage.workflow;
    const outKey = store.latestKey(`agent_ir:${node.id}`);

    if (!checkExpiry(ctx.ctx, {
        inputKeys: store.latestKey("artifact_relations"),
        outputKeys: outKey,
    })) {
        const cached = store.getAgentIR(node.id);
        if (cached) return cached;
    }

    // 收集扩展输入：前置节点 outputs + 全局 inputs
    const predecessorOutputs = collectPredecessorOutputs(ctx, flow, node);
    const flowInputs = flow.inputs;

    const artifactContext = buildArtifactContext(node, relations, predecessorOutputs, flowInputs);

    const { text } = await generateText({
        model: getSmartModel(undefined, ctx.ctx),
        instructions: DECOMPOSE_INSTRUCTIONS,
        prompt:
            `## 工作流总目标\n${flow.intent}\n\n` +
            `## 当前步骤\n` +
            `- 名称：${node.name}\n` +
            `- 目的：${node.intent}\n` +
            `- 声明的输入：${node.inputs.map((i) => `\`${i}\``).join("、") || "（无）"}\n` +
            `- 声明的输出：${node.outputs.map((o) => `\`${o}\``).join("、") || "（无）"}\n` +
            `- 动作描述：${node.actionAtom}\n\n` +
            `## 可用产物（含语义关系）\n${artifactContext}\n\n` +
            `## 前置节点的产出（可选输入）\n` +
            predecessorOutputs.map((n) => `- \`${n}\``).join("\n") +
            `\n\n## 全局输入（可选输入）\n` +
            flowInputs.map((n) => `- \`${n}\``).join("\n") +
            `\n\n请编译该步骤为 Agent IR。`,
    });

    store.saveAgentIR(node.id, text);
    return text;
}

function findMainFlow(ctx: WeaveContext): HumanFlow | null {
    const flows = ctx.conceptManager.listHumanFlows();
    return flows.find((f) => (f as HumanFlow).isMain === true) ?? flows[0] ?? null;
}

function collectPredecessorOutputs(ctx: WeaveContext, flow: HumanFlow, node: HumanNode): string[] {
    const out: string[] = [];
    flow.g.forEachInNeighbor(node.id, (predecessorId) => {
        const pred = ctx.conceptManager.nodes.get(predecessorId);
        if (pred) {
            for (const outId of pred.outputs) {
                const a = ctx.conceptManager.artifacts.get(outId);
                if (a) out.push(a.name);
            }
        }
    });
    return [...new Set(out)];
}

function buildArtifactContext(
    node: HumanNode,
    relations: Record<string, ArtifactRelation>,
    predecessorOutputs: string[],
    flowInputs: string[],
): string {
    const involved = new Set<string>([
        ...node.inputs,
        ...node.outputs,
        ...predecessorOutputs,
        ...flowInputs,
    ]);

    const lines: string[] = [];
    for (const name of involved) {
        const rel = relations[name];
        if (!rel) {
            lines.push(`- \`${name}\``);
            continue;
        }
        const parts: string[] = [`\`${name}\``];
        if (rel.partOf.length > 0) parts.push(`partOf: [${rel.partOf.join(", ")}]`);
        if (rel.composedOf.length > 0) parts.push(`composedOf: [${rel.composedOf.join(", ")}]`);
        if (rel.arrayOf) parts.push(`arrayOf: ${rel.arrayOf}`);
        if (rel.refinedFrom.length > 0) parts.push(`refinedFrom: [${rel.refinedFrom.join(", ")}]`);
        lines.push(`- ${parts.join(", ")}`);
    }
    return lines.join("\n");
}