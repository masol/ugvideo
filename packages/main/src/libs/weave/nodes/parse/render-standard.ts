/**
 * weaver · 由结构化数据确定性渲染标准格式 markdown
 *
 * 与 safefmt 抽取配合：抽取得到结构化 JSON 后，由代码渲染标准格式，
 * 格式 100% 正确——不再依赖 LLM 保证格式，也就不存在"反引号漏写"这类脆弱点。
 *
 * 渲染结果与 keywords.ts 中的首选关键字一致，供人类阅读 / 首行图名定位使用。
 */

import {
    KW_ACTION,
    KW_CONDITION,
    KW_EXTERNAL_TARGET,
    KW_GLOBAL_INPUTS,
    KW_INPUTS,
    KW_INTERNAL_TARGET,
    KW_JUMPS,
    KW_OUTPUTS,
    KW_PURPOSE,
} from "./keywords.js";
import type { ParsedGlobalInput, ParsedJumper, ParsedNode } from "./standard.js";

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

    // 全局输入：仅在存在时渲染（v12 起为可选段）
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
        if (node.jumpers.length > 0) {
            lines.push(`- ${KW_JUMPS[0]}：`);
            for (const jp of node.jumpers) {
                lines.push(...renderJumper(jp));
            }
        }
        lines.push("");
    });

    return lines.join("\n");
}

function renderArtifacts(names: string[]): string {
    if (names.length === 0) return "（无）";
    return names.map((n) => `\`${n}\``).join(" ");
}

function renderJumper(jp: ParsedJumper): string[] {
    const targetKw = jp.kind === "external" ? KW_EXTERNAL_TARGET[0] : KW_INTERNAL_TARGET[0];
    if (jp.condition) {
        return [`  - ${KW_CONDITION[0]}：${jp.condition}`, `    ${targetKw}：${jp.target}`];
    }
    return [`  - 否则：`, `    ${targetKw}：${jp.target || "结束"}`];
}