/**
 * weaver · 由结构化数据确定性渲染标准格式 markdown
 *
 * 变更：删除跳转段渲染。控制流/约束以自然语言内蕴在动作里。
 * 配置项渲染其完整默认值（模板/清单全文），保证信息不丢失。
 */

import {
    KW_ACTION,
    KW_GLOBAL_INPUTS,
    KW_INPUTS,
    KW_OUTPUTS,
    KW_PURPOSE,
} from "./keywords.js";
import type { ParsedGlobalInput, ParsedNode } from "./parse-types.js";

export function renderStandardDoc(
    flowName: string,
    goal: string,
    globalInputs: ParsedGlobalInput[],
    nodes: ParsedNode[],
): string {
    const lines: string[] = [];

    lines.push(`# ${flowName}`);
    lines.push("");
    lines.push(goal || "（无总则）");
    lines.push("");
    lines.push("---");
    lines.push("");

    if (globalInputs.length > 0) {
        lines.push(`## ${KW_GLOBAL_INPUTS[0]}`);
        lines.push("");
        for (const gi of globalInputs) {
            if (gi.hasDefault) {
                lines.push(`- 配置项 \`${gi.key}\`（默认：${gi.defaultValue ?? ""}）`);
            } else {
                lines.push(`- 输入项 \`${gi.key}\``);
            }
        }
        lines.push("");
    }

    nodes.forEach((node, i) => {
        lines.push(`## ${i + 1}. ${node.name}`);
        lines.push("");
        lines.push(`- ${KW_PURPOSE[0]}：${node.intent}`);
        lines.push(`- ${KW_INPUTS[0]}：${renderArtifacts(node.inputs)}`);
        lines.push(`- ${KW_OUTPUTS[0]}：${renderArtifacts(node.outputs)}`);
        lines.push(`- ${KW_ACTION[0]}：${node.action}`);
        lines.push("");
    });

    return lines.join("\n");
}

function renderArtifacts(names: string[]): string {
    if (names.length === 0) return "（无）";
    return names.map((n) => `\`${n}\``).join(" ");
}