/**
 * weaver · parse · 动作完整性校验（v2）
 *
 * 变更（v2）：删除"反向输入自洽"检查。
 *
 *   为什么删：
 *   实测证据（微信长文工作流，4 轮 reAct 全部因它失败）表明，原反向检查
 *   「步骤声明的输入若未在动作文本中逐字出现则报错」存在两个致命问题：
 *
 *   1. 前提不成立：自然语言中"使用一个输入"根本不要求逐字复述其名称
 *      （动作写"基于骨架展开"，输入名叫"文章骨架"，语义上已使用，但子串
 *      匹配判定为"未引用"）。用文本子串匹配判定"是否使用"必然大量误报。
 *
 *   2. 与前向检查死锁：前向要求"动作里反引号提及的名字必须已声明"，反向
 *      要求"声明的输入必须在动作里出现"。LLM 为满足反向而在动作里补写输入
 *      名（反引号包裹），又触发前向"提及未声明"。两个检查互斥，LLM 在两者
 *      间反复横跳，reAct 永不收敛。
 *
 *   为什么删它安全（无实质能力损失）：
 *   - 反向检查想防的是"声明了没用的输入"——这最多是冗余（多读一个 KV），
 *     不影响 DAG 正确性、不影响生成代码正确性；
 *   - 真正有害的是反过来"动作用了某上游产物却没声明为输入"（导致 DAG 缺边）——
 *     这由保留的【前向检查】+ orphans 检查共同兜住，未被放过。
 *
 *   保留的前向检查：action 中反引号提及的产物名，若未在该步骤 inputs/outputs
 *   或全局输入中声明，则报告——防止 DAG 缺边。此方向修复目标明确（把名字加进
 *   声明），不与其它检查互斥，无死锁风险。
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

        // 前向：动作中反引号提及的产物名，未在本步骤 inputs/outputs 或全局输入中声明 → 报告。
        // 目的：防止 DAG 缺边（动作用了某产物却没把它声明为输入/输出）。
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