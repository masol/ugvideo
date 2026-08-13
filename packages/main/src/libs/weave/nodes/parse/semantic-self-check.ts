/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * weaver · parse · 语义自检（v13）
 *
 * 3 项内部校验，全部用纯文本模式（mdast 解析 + 正则），不调 LLM：
 * 1. 名称对齐：扫描所有节点，提取产物名同类项（基于字面 + 关键词重叠），发现疑似不一致
 * 2. 可行性：动作段不能为空、不能含 TODO/未完成标记
 * 3. 完整性：每个节点的输入/输出/动作三项必须存在
 */

import type { Heading, List, ListItem, Root, RootContent } from "mdast";
import remarkParse from "remark-parse";
import { unified } from "unified";
import type { WeaveContext } from "../../context.js";

export interface SemanticCheckResult {
    issues: string[];
    checkedSteps: number;
}

export function semanticSelfCheck(doc: string, _ctx: WeaveContext): SemanticCheckResult {
    const issues: string[] = [];

    // 1. 解析为 mdast
    let tree: Root;
    try {
        tree = unified().use(remarkParse).parse(doc);
    } catch (e: any) {
        issues.push(`markdown 解析失败：${e?.message ?? String(e)}`);
        return { issues, checkedSteps: 0 };
    }

    // 2. 提取所有步骤节点
    const stepSections = extractStepSections(tree.children);
    if (stepSections.length === 0) {
        issues.push("未找到任何步骤节点（## N. xxx）。");
        return { issues, checkedSteps: 0 };
    }

    // 3. 完整性 + 可行性检查
    for (const sec of stepSections) {
        const name = sec.heading?.replace(/^\d+\.\s*/, "").trim() ?? "未命名步骤";
        const fields = extractListFields(sec.body);

        if (!fields["输入"]) {
            issues.push(`步骤「${name}」缺少「输入」字段。`);
        }
        if (!fields["输出"]) {
            issues.push(`步骤「${name}」缺少「输出」字段。`);
        }
        if (!fields["动作"]) {
            issues.push(`步骤「${name}」缺少「动作」字段。`);
        } else {
            const action = fields["动作"].trim();
            if (action.length === 0) {
                issues.push(`步骤「${name}」的「动作」字段为空。`);
            } else if (/TODO|待补|待定|未完成|xxx/iu.test(action)) {
                issues.push(`步骤「${name}」的「动作」字段含未完成标记（TODO/待补/未完成）。`);
            }
        }
    }

    // 4. 名称对齐检查
    const nameAlignIssues = checkNameAlignment(stepSections);
    issues.push(...nameAlignIssues);

    return { issues, checkedSteps: stepSections.length };
}

interface StepSection {
    heading: string | null;
    body: RootContent[];
}

function extractStepSections(children: RootContent[]): StepSection[] {
    const sections: StepSection[] = [];
    let current: StepSection | null = null;
    let passedH1 = false;

    for (const node of children) {
        if (node.type === "heading" && node.depth === 1) {
            passedH1 = true;
            continue;
        }
        if (!passedH1) continue;

        if (node.type === "heading" && node.depth === 2) {
            const heading = (node as Heading).children
                .map((c) => ("value" in c ? c.value : ""))
                .join("")
                .trim();
            if (/^\d+\.\s*.+/.test(heading)) {
                current = { heading, body: [] };
                sections.push(current);
            }
            continue;
        }

        if (current) current.body.push(node);
    }

    return sections;
}

function extractListFields(body: RootContent[]): Record<string, string> {
    const fields: Record<string, string> = {};

    for (const node of body) {
        if (node.type !== "list" || (node as List).ordered) continue;
        for (const item of (node as List).children) {
            const li = item as ListItem;
            const firstChild = li.children[0];
            if (!firstChild || firstChild.type !== "paragraph") continue;
            const text = plainText(firstChild).trim();
            const m = text.match(/^([^：:\s]+)[：:]\s*([\s\S]*)$/);
            if (m) fields[m[1]] = m[2];
        }
    }

    return fields;
}

/**
 * 名称对齐检查：提取所有节点输入/输出/动作中的名词短语，
 * 出现"看起来应该一致但实际不同"的情况时报问题。
 *
 * 启发式：
 * - 收集所有出现过的「输入」/「输出」中的名词
 * - 对每个名词，用 jaccard 相似度找它的「似是而非」的别名（不在同一节点出现但在不同节点出现）
 * - 报疑似不一致
 */
function checkNameAlignment(steps: StepSection[]): string[] {
    const issues: string[] = [];

    // 提取每个节点出现的所有名词短语（粗略：分句 + 顿号拆分）
    const namesByStep: string[][] = [];
    for (const sec of steps) {
        const fields = extractListFields(sec.body);
        const allText = `${fields["输入"] ?? ""} ${fields["输出"] ?? ""}`;
        const names = splitToPhrases(allText);
        namesByStep.push(names);
    }

    // 收集全部名词，统计频次
    const freq = new Map<string, number>();
    for (const names of namesByStep) {
        for (const n of names) freq.set(n, (freq.get(n) ?? 0) + 1);
    }

    // 对低频名词（出现 1 次）检查是否存在「高频近义词」
    const highFreq = [...freq.entries()].filter(([, c]) => c >= 2).map(([n]) => n);
    for (let i = 0; i < steps.length; i++) {
        const stepName = steps[i].heading?.replace(/^\d+\.\s*/, "").trim() ?? `步骤${i + 1}`;
        for (const name of namesByStep[i]) {
            if (freq.get(name)! >= 2) continue;
            // 找疑似近义
            for (const h of highFreq) {
                if (name === h) continue;
                if (isSimilar(name, h)) {
                    issues.push(
                        `步骤「${stepName}」使用了名词「${name}」（仅出现 1 次），` +
                        `但其他步骤中用了类似名词「${h}」（出现 ${freq.get(h)} 次）。` +
                        `请统一名称。`,
                    );
                    break;
                }
            }
        }
    }

    return issues;
}

function splitToPhrases(text: string): string[] {
    if (!text) return [];
    const cleaned = text.replace(/（无）|\(none\)/gi, "").trim();
    if (!cleaned) return [];
    return cleaned
        .split(/[、，,；;\s\n]+/)
        .map((s) => s.trim())
        .filter((s) => s.length >= 2 && s.length <= 20);
}

function isSimilar(a: string, b: string): boolean {
    if (a.length < 2 || b.length < 2) return false;
    if (a.includes(b) || b.includes(a)) return true;
    const setA = new Set(a);
    const setB = new Set(b);
    const inter = [...setA].filter((c) => setB.has(c)).length;
    const union = new Set([...setA, ...setB]).size;
    return union > 0 && inter / union >= 0.6;
}

function plainText(node: any): string {
    if ("value" in node && typeof node.value === "string") return node.value;
    if ("children" in node && Array.isArray(node.children)) {
        return node.children.map(plainText).join("");
    }
    return "";
}