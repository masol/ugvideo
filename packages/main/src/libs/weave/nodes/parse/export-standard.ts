/**
 * weaver · 导出标准格式
 *
 * 将内存中的 HumanFlow 导出为标准格式 markdown。
 */

import type { WeaveContext } from "../../context.js";
import type { ExternalEdge, HumanFlow, HumanNode } from "../../types.js";

export function exportToStandardFormat(
    flow: HumanFlow,
    ctx: WeaveContext
): string {
    const lines: string[] = [];

    // 一级标题：工作流名称
    lines.push(`# ${flow.name}`);
    lines.push("");
    lines.push(flow.intent || "（无总则）");
    lines.push("");
    lines.push("---");
    lines.push("");

    // 全局输入（从 flow.inputs 推导）
    lines.push("## 全局输入");
    lines.push("");

    if (flow.inputs.length === 0) {
        lines.push("- （无外部输入）");
    } else {
        for (const inputId of flow.inputs) {
            const artifact = ctx.conceptManager.artifacts.get(inputId);
            const artifactName = artifact?.name ?? inputId.slice(0, 8);
            lines.push(`- 输入项 \`${artifactName}\``);
        }
    }
    lines.push("");

    // 节点清单（按拓扑序）
    const nodes = flow.g.nodes()
        .map((id) => ctx.conceptManager.nodes.get(id))
        .filter((n): n is HumanNode => n !== null);

    for (let i = 0; i < nodes.length; i++) {
        const node = nodes[i];
        lines.push(`## ${i + 1}. ${node.name}`);
        lines.push("");
        lines.push(`- 目的：${node.intent}`);

        const inputNames = node.inputs
            .map((id) => {
                const a = ctx.conceptManager.artifacts.get(id);
                return a ? `\`${a.name}\`` : `\`${id.slice(0, 8)}\``;
            })
            .join(" ");
        lines.push(`- 输入：${inputNames}`);

        const outputNames = node.outputs
            .map((id) => {
                const a = ctx.conceptManager.artifacts.get(id);
                return a ? `\`${a.name}\`` : `\`${id.slice(0, 8)}\``;
            })
            .join(" ");
        lines.push(`- 输出：${outputNames}`);

        lines.push(`- 动作：${node.actionAtom}`);

        if (node.externalEdges.length > 0) {
            lines.push("- 跳转：");
            for (const edge of node.externalEdges) {
                lines.push(renderJumpLine(edge, nodes, ctx));
            }
        }
        lines.push("");
    }

    return lines.join("\n");
}

function renderJumpLine(
    edge: ExternalEdge,
    nodes: HumanNode[],
    ctx: WeaveContext,
): string {
    if (edge.kind === "external") {
        const targetGraph = ctx.conceptManager.graphs.get(edge.targetGraphId);
        const subName = targetGraph ? targetGraph.name : edge.targetGraphId;
        return `  - 子流程：若 \`${edge.condition ?? ""}\` → 调用子流程 \`${subName}\` 的步骤 1（返回：${edge.returnAfter ? "是" : "否"}）`;
    }

    const targetIdx = nodes.findIndex((n) => n.id === edge.target);
    const targetRef = targetIdx >= 0 ? `步骤 ${targetIdx + 1}` : "结束";

    if (edge.condition) {
        return `  - 若 \`${edge.condition}\` → ${targetRef}`;
    }
    return `  - 否则 → ${targetRef}`;
}