/**
 * weaver · 导出标准格式（HumanFlow → markdown）
 *
 * 变更：删除跳转段导出。
 */

import type { WeaveContext } from "../../context.js";
import type { HumanFlow, HumanNode } from "../../types.js";
import {
    KW_ACTION,
    KW_GLOBAL_INPUTS,
    KW_INPUTS,
    KW_OUTPUTS,
    KW_PURPOSE,
} from "./keywords.js";

export function exportToStandardFormat(
    flow: HumanFlow,
    ctx: WeaveContext
): string {
    const lines: string[] = [];

    lines.push(`# ${flow.name}`);
    lines.push("");
    lines.push(flow.intent || "（无总则）");
    lines.push("");
    lines.push("---");
    lines.push("");

    lines.push(`## ${KW_GLOBAL_INPUTS[0]}`);
    lines.push("");

    if (flow.inputs.length === 0) {
        lines.push("- （无外部输入）");
    } else {
        for (const inputId of flow.inputs) {
            const artifact = ctx.conceptManager.artifacts.get(inputId);
            const name = artifact?.name ?? inputId;
            lines.push(`- 输入项 \`${name}\``);
        }
    }
    lines.push("");

    const nodes = flow.g.nodes()
        .map((id) => ctx.conceptManager.nodes.get(id))
        .filter((n): n is HumanNode => n !== null);

    for (let i = 0; i < nodes.length; i++) {
        const node = nodes[i];
        lines.push(`## ${i + 1}. ${node.name}`);
        lines.push("");

        lines.push(`- ${KW_PURPOSE[0]}：${node.intent}`);

        const inputNames = node.inputs
            .map((id) => {
                const a = ctx.conceptManager.artifacts.get(id);
                return a ? `\`${a.name}\`` : `\`${id}\``;
            })
            .join(" ");
        lines.push(`- ${KW_INPUTS[0]}：${inputNames}`);

        const outputNames = node.outputs
            .map((id) => {
                const a = ctx.conceptManager.artifacts.get(id);
                return a ? `\`${a.name}\`` : `\`${id}\``;
            })
            .join(" ");
        lines.push(`- ${KW_OUTPUTS[0]}：${outputNames}`);

        lines.push(`- ${KW_ACTION[0]}：${node.actionAtom}`);
        lines.push("");
    }

    return lines.join("\n");
}