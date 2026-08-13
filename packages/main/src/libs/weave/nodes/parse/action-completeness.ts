/**
 * weaver · parse · 动作完整性 + 输入自洽性校验
 *
 * 两个方向的校验（均以反馈驱动 reAct 自我修正，非硬失败）：
 *
 * 1. 前向（原有）：action 中反引号提及的产物名，若未在该步骤 inputs/outputs 或全局输入中
 *    声明，则报告——防止漏声明。
 *
 * 2. 反向（新增）：该步骤声明的 inputs 若未在 action 文本中出现，则报告——把每个步骤视作
 *    一个"函数"，声明的入参必须被真正使用；未使用的输入应删除或在动作中体现如何使用。
 *    这直接命中"通用写作常识/个人经验储备被声明却从未使用"这类不自洽问题。
 *
 * 注意：两个方向都基于文本约定（反引号 / 名称出现）。若模型偶发未按约定书写会有误报，
 * 但反馈进入 reAct 循环让模型自查修正，代价可控。
 */

import type { ParsedGlobalInput, ParsedNode } from "./parse-types.js";

export function checkActionCompleteness(
    nodes: ParsedNode[],
    globalInputs: ParsedGlobalInput[],
): string[] {
    const issues: string[] = [];
    const globalNames = new Set(globalInputs.map((gi) => gi.key));

    for (const node of nodes) {
        const declaredIO = new Set([...node.inputs, ...node.outputs, ...globalNames]);

        // 前向：动作提及但未声明
        const mentions = extractMentions(node.action);
        const missing = mentions.filter((m) => !declaredIO.has(m));
        if (missing.length > 0) {
            issues.push(
                `[动作完整性] 步骤「${node.name}」的动作段提及了「${missing.join("、")}」，` +
                `但这些产物未在该步骤的输入/输出或全局输入中声明。` +
                `请检查：(a) 是否漏写了输入/输出；(b) 是否是内部中间变量（无需声明）；` +
                `(c) 是否名称不一致（应统一）。`,
            );
        }

        // 反向：声明了输入却未在动作中使用
        const unusedInputs = node.inputs.filter((name) => !actionReferences(node.action, name));
        if (unusedInputs.length > 0) {
            issues.push(
                `[输入自洽] 步骤「${node.name}」声明了输入「${unusedInputs.join("、")}」，` +
                `但动作段中并未引用它们。把每个步骤当作一个函数：入参必须被真正使用。` +
                `请二选一修正：(a) 若动作确实需要用到，请在动作中明确写出如何使用（并用反引号引用其名称）；` +
                `(b) 若并不需要，请从该步骤的输入中移除，保持自洽。`,
            );
        }
    }

    return issues;
}

/**
 * 从 action 文本中提取反引号包裹的名词（疑似产物名）。
 */
function extractMentions(action: string): string[] {
    if (!action) return [];
    const pattern = /`([^`]+)`/g;
    const matches = [...action.matchAll(pattern)];
    return matches
        .map((m) => m[1].trim())
        .filter((name) => {
            if (name.length === 0) return false;
            if (name.length === 1) return false;
            if (/^\d+$/.test(name)) return false;
            if (/^[，。；：、""''（）\s]+$/.test(name)) return false;
            return true;
        });
}

/** 动作文本是否引用了某个输入名（子串匹配，容忍是否带反引号） */
function actionReferences(action: string, name: string): boolean {
    if (!action || !name) return false;
    return action.includes(name);
}