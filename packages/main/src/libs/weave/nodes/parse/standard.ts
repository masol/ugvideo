/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * weaver · parse · 标准格式校验 + 构造 HumanFlow（v12）
 *
 * v12 变化：
 * - 跳转字段变为可选；不出现则视为"无跳转"（跳转已内蕴在动作中）
 * - 全局输入字段变为可选；不出现则视为"无全局输入"（依赖由动作中声明）
 */

import type { Heading, List, ListItem, Root, RootContent } from "mdast";
import remarkParse from "remark-parse";
import { unified } from "unified";
import type { WeaveContext } from "../../context.js";
import type { HumanFlow } from "../../types.js";
import { buildHumanFlowFromParsed } from "./build-flow.js";

// ════════════════════════════════════════════════════════════════════
// 关键字定义（中英文同义）
// ════════════════════════════════════════════════════════════════════

const KW_GLOBAL_INPUTS: string[] = ["全局输入", "Global Inputs"];
const KW_PURPOSE: string[] = ["目的", "Purpose"];
const KW_INPUTS: string[] = ["输入", "Inputs"];
const KW_OUTPUTS: string[] = ["输出", "Outputs"];
const KW_ACTION: string[] = ["动作", "Action"];
const KW_JUMPS: string[] = ["跳转", "Jumps"];
const KW_CONDITION: string[] = ["条件", "Condition"];
const KW_INTERNAL_TARGET: string[] = ["内部目标", "Internal Target"];
const KW_EXTERNAL_TARGET: string[] = ["外部目标", "External Target"];

const REQUIRED_NODE_FIELDS: string[][] = [KW_PURPOSE, KW_INPUTS, KW_OUTPUTS, KW_ACTION];

// ════════════════════════════════════════════════════════════════════
// 公开接口
// ════════════════════════════════════════════════════════════════════

export interface CollectedSections {
    flowName: string;
    goal: string;
    globalInputs: ParsedGlobalInput[];
    parsedNodes: ParsedNode[];
    rawStepSections: FlowSection[];
}

export interface StandardResult {
    flow: HumanFlow | null;
    errors: ParseError[];
    sections: CollectedSections | null;
}

export interface ParsedGlobalInput {
    key: string;
    hasDefault: boolean;
    defaultValue?: string;
}

export interface ParsedJumper {
    kind: "internal" | "external";
    condition: string | null;
    target: string;
}

export interface SourceLines {
    start: number;
    end: number;
}

export interface ParsedNode {
    order: number;
    name: string;
    intent: string;
    inputs: string[];
    outputs: string[];
    action: string;
    jumpers: ParsedJumper[];
    sourceLines: SourceLines;
}

export interface FlowSection {
    heading: string | null;
    body: RootContent[];
    startLine: number;
    endLine: number;
}

export interface ParseError {
    scope: "global" | "node" | "field";
    field: string;
    nodeName?: string;
    line?: number;
    snippet?: string;
    fix: string;
}

// ════════════════════════════════════════════════════════════════════
// 公开函数
// ════════════════════════════════════════════════════════════════════

export function parseMarkdown(markdown: string): Root {
    return unified().use(remarkParse).parse(markdown);
}

export function tryStandard(tree: Root, ctx: WeaveContext): StandardResult {
    const errors: ParseError[] = [];

    const h1Nodes = tree.children.filter(
        (n): n is Heading => n.type === "heading" && n.depth === 1,
    );
    if (h1Nodes.length !== 1) {
        errors.push({
            scope: "global",
            field: "h1",
            snippet: h1Nodes.map((h) => headingText(h)).join(", ") || "（缺失）",
            fix: `必须恰好 1 个一级标题（# 工作流名称），当前有 ${h1Nodes.length} 个。请保留唯一一个 # 标题。`,
        });
        return { flow: null, errors, sections: null };
    }

    const flowName = headingText(h1Nodes[0]);
    if (!flowName) {
        errors.push({
            scope: "global",
            field: "h1",
            line: h1Nodes[0].position?.start.line,
            fix: "一级标题为空。请填写工作流名称。",
        });
        return { flow: null, errors, sections: null };
    }

    const allSections = collectFlowSections(tree.children);
    const goal = extractGoal(allSections.preSteps);

    const globalInputSection = allSections.sections.find(
        (s) => s.heading && matchKeyword(s.heading, KW_GLOBAL_INPUTS),
    );
    let globalInputs: ParsedGlobalInput[] = [];
    if (globalInputSection) {
        const gi = parseGlobalInputs(globalInputSection);
        if (gi === null) {
            errors.push({
                scope: "global",
                field: "global_inputs",
                line: globalInputSection.startLine,
                snippet: snippetOf(globalInputSection.body, 80),
                fix: "「全局输入」格式非法。每行必须严格为：`- 输入项 \\`名称\\`` 或 `- 配置项 \\`名称\\`（默认：xxx）`。",
            });
        } else {
            globalInputs = gi;
        }
    }

    const stepSections = allSections.sections.filter(
        (s) => s.heading && /^\d+\.\s*.+/.test(s.heading),
    );

    if (stepSections.length === 0) {
        errors.push({
            scope: "global",
            field: "steps",
            fix: "未找到任何步骤节点。每个步骤必须是二级标题，格式：`## 1. 步骤名称`（编号从 1 开始连续）。",
        });
        return {
            flow: null,
            errors,
            sections: { flowName, goal, globalInputs, parsedNodes: [], rawStepSections: [] },
        };
    }

    const parsedNodes: ParsedNode[] = [];

    for (const sec of stepSections) {
        const result = parseStandardNode(sec);
        if (!result.node) {
            errors.push(...result.errors);
            continue;
        }
        parsedNodes.push(result.node);
    }

    const sections: CollectedSections = {
        flowName,
        goal,
        globalInputs,
        parsedNodes,
        rawStepSections: stepSections,
    };

    if (errors.length > 0) {
        return { flow: null, errors, sections };
    }

    for (let i = 0; i < parsedNodes.length; i++) {
        if (parsedNodes[i].order !== i + 1) {
            errors.push({
                scope: "global",
                field: "step_order",
                nodeName: parsedNodes[i].name,
                line: stepSections[i].startLine,
                fix: `节点序号不连续：期望 ${i + 1}，实际 ${parsedNodes[i].order}。请按 ## 1.、## 2.、## 3. … 连续编号。`,
            });
            return { flow: null, errors, sections };
        }
    }

    const flow = buildHumanFlowFromParsed(flowName, goal, globalInputs, parsedNodes, ctx);
    return { flow, errors: [], sections };
}

// ════════════════════════════════════════════════════════════════════
// markdown 结构提取
// ════════════════════════════════════════════════════════════════════

function collectFlowSections(children: RootContent[]): {
    preSteps: RootContent[];
    sections: FlowSection[];
} {
    const preSteps: RootContent[] = [];
    const sections: FlowSection[] = [];
    let current: FlowSection | null = null;
    let passedH1 = false;

    for (const node of children) {
        if (node.type === "heading" && node.depth === 1) {
            passedH1 = true;
            continue;
        }
        if (!passedH1) continue;

        if (node.type === "heading" && node.depth === 2) {
            current = {
                heading: headingText(node),
                body: [],
                startLine: node.position?.start.line ?? 1,
                endLine: node.position?.end.line ?? 1,
            };
            sections.push(current);
            continue;
        }

        if (current) {
            current.body.push(node);
            const nodeEndLine = node.position?.end.line ?? current.endLine;
            if (nodeEndLine > current.endLine) current.endLine = nodeEndLine;
        } else {
            preSteps.push(node);
        }
    }

    return { preSteps, sections };
}

function extractGoal(preSteps: RootContent[]): string {
    const texts: string[] = [];
    for (const node of preSteps) {
        if (node.type === "paragraph") texts.push(plainText(node));
        else if (node.type === "thematicBreak") break;
    }
    return texts.join("\n\n").trim();
}

function parseGlobalInputs(section: FlowSection): ParsedGlobalInput[] | null {
    const inputs: ParsedGlobalInput[] = [];
    for (const node of section.body) {
        if (node.type !== "list" || node.ordered) return null;
        for (const item of node.children) {
            const entry = parseGlobalInputItem(item);
            if (!entry) return null;
            inputs.push(entry);
        }
    }
    return inputs;
}

function parseGlobalInputItem(item: ListItem): ParsedGlobalInput | null {
    const text = plainText(item).trim();
    const configMatch = text.match(/^-\s*配置项\s+`([^`]+)`（默认：([^）]+)）\s*$/);
    const inputMatch = text.match(/^-\s*输入项\s+`([^`]+)`\s*$/);
    if (configMatch) {
        return { key: configMatch[1], hasDefault: true, defaultValue: configMatch[2] };
    }
    if (inputMatch) {
        return { key: inputMatch[1], hasDefault: false };
    }
    return null;
}

// ════════════════════════════════════════════════════════════════════
// 节点解析 —— 句法驱动 + 结构化错误
// ════════════════════════════════════════════════════════════════════

interface ParseNodeResult {
    node: ParsedNode | null;
    errors: ParseError[];
}

function parseStandardNode(section: FlowSection): ParseNodeResult {
    const errors: ParseError[] = [];
    const heading = section.heading ?? "";
    const m = heading.match(/^(\d+)\.\s*(.+)$/);
    if (!m) {
        errors.push({
            scope: "node",
            field: "heading",
            line: section.startLine,
            snippet: heading,
            fix: "步骤标题格式非法。必须是 `## N. 步骤名称`（N 从 1 开始连续编号）。",
        });
        return { node: null, errors };
    }

    const order = parseInt(m[1], 10);
    const name = m[2].trim();

    const fieldResult = extractListFields(section.body, name, section.startLine);
    if (!fieldResult.fields) {
        errors.push(...fieldResult.errors);
        return { node: null, errors };
    }
    const fields = fieldResult.fields;

    for (const required of REQUIRED_NODE_FIELDS) {
        if (!(required[0] in fields)) {
            errors.push({
                scope: "field",
                field: required[0],
                nodeName: name,
                line: section.startLine,
                snippet: section.heading ?? "",
                fix: `节点「${name}」缺少必填字段「${required[0]}」。请在列表中添加一行：\n- ${required[0]}：<内容>`,
            });
        }
    }
    if (errors.length > 0) return { node: null, errors };

    const inputsResult = parseArtifactList(fields[KW_INPUTS[0]]);
    if (inputsResult === null) {
        errors.push({
            scope: "field",
            field: KW_INPUTS[0],
            nodeName: name,
            line: section.startLine,
            snippet: fields[KW_INPUTS[0]],
            fix: `节点「${name}」的「${KW_INPUTS[0]}」格式非法。每个产物名必须用反引号包裹，多个用空格分隔。例如：\`素材清单\` \`目标读者画像\`。若无输入写：${KW_INPUTS[0]}：（无）`,
        });
        return { node: null, errors };
    }

    const outputsResult = parseArtifactList(fields[KW_OUTPUTS[0]]);
    if (outputsResult === null) {
        errors.push({
            scope: "field",
            field: KW_OUTPUTS[0],
            nodeName: name,
            line: section.startLine,
            snippet: fields[KW_OUTPUTS[0]],
            fix: `节点「${name}」的「${KW_OUTPUTS[0]}」格式非法。每个产物名必须用反引号包裹，多个用空格分隔。例如：\`初稿文章\`。若无输出写：${KW_OUTPUTS[0]}：（无）`,
        });
        return { node: null, errors };
    }

    let jumpers: ParsedJumper[] = [];
    if (fields[KW_JUMPS[0]] && fields[KW_JUMPS[0]].trim() !== "（无）") {
        const jps = parseJumperList(fields[KW_JUMPS[0]]);
        if (jps === null) {
            errors.push({
                scope: "field",
                field: KW_JUMPS[0],
                nodeName: name,
                line: section.startLine,
                snippet: fields[KW_JUMPS[0]].slice(0, 120),
                fix: `节点「${name}」的「${KW_JUMPS[0]}」格式非法。`,
            });
            return { node: null, errors };
        }
        jumpers = jps;
    }

    return {
        node: {
            order,
            name,
            intent: fields[KW_PURPOSE[0]].trim(),
            inputs: inputsResult,
            outputs: outputsResult,
            action: fields[KW_ACTION[0]].trim(),
            jumpers,
            sourceLines: { start: section.startLine, end: section.endLine },
        },
        errors: [],
    };
}

interface ExtractFieldsResult {
    fields: Record<string, string> | null;
    errors: ParseError[];
}

function extractListFields(
    body: RootContent[],
    nodeName: string,
    nodeLine: number,
): ExtractFieldsResult {
    const errors: ParseError[] = [];
    const fields: Record<string, string> = {};

    for (const node of body) {
        if (node.type !== "list" || node.ordered) {
            errors.push({
                scope: "node",
                field: "body",
                nodeName,
                line: nodeLine,
                snippet: node.type,
                fix: `节点「${nodeName}」的内容必须全部是无序列表（以 - 开头）。`,
            });
            return { fields: null, errors };
        }
    }

    for (const node of body) {
        if (node.type !== "list") continue;
        for (const item of node.children) {
            const parsed = parseFieldItem(item);
            if (!parsed) {
                errors.push({
                    scope: "field",
                    field: "list_item",
                    nodeName,
                    line: nodeLine,
                    snippet: plainText(item).slice(0, 80),
                    fix: `节点「${nodeName}」的列表项格式非法。必须是「字段名：值」的格式。`,
                });
                continue;
            }
            fields[parsed.key] = parsed.value;
        }
    }

    if (errors.length > 0) return { fields: null, errors };
    return { fields, errors: [] };
}

function parseFieldItem(item: ListItem): { key: string; value: string } | null {
    const firstChild = item.children[0];
    if (!firstChild || firstChild.type !== "paragraph") return null;

    const text = plainText(firstChild).trim();
    const m = text.match(/^([^：:\s]+)[：:]\s*([\s\S]*)$/);
    if (!m) return null;

    const key = m[1];
    const inlineValue = m[2];

    if (item.children.length > 1) {
        const subLists = item.children.slice(1).filter(
            (c): c is List => c.type === "list",
        );
        if (subLists.length > 0) {
            const subTexts: string[] = [inlineValue];
            for (const sub of subLists) {
                for (const subItem of sub.children) {
                    subTexts.push("- " + plainText(subItem).trim());
                }
            }
            return { key, value: subTexts.join("\n") };
        }
    }

    return { key, value: inlineValue };
}

function parseArtifactList(text: string): string[] | null {
    const trimmed = text.trim();
    if (trimmed === "（无）" || trimmed.toLowerCase() === "(none)") return [];

    const names: string[] = [];
    const re = /`([^`]+)`|「([^」]+)」/g;
    let m: RegExpExecArray | null;
    let lastIndex = 0;
    while ((m = re.exec(text)) !== null) {
        const between = text.slice(lastIndex, m.index).trim();
        if (between) return null;
        names.push(m[1] ?? m[2]);
        lastIndex = re.lastIndex;
    }
    if (lastIndex !== text.length) {
        const tail = text.slice(lastIndex).trim();
        if (tail) return null;
    }
    return names;
}

// ════════════════════════════════════════════════════════════════════
// 跳转解析 —— 兼容中英文关键字
// ════════════════════════════════════════════════════════════════════

function parseJumperList(text: string): ParsedJumper[] | null {
    const trimmed = text.trim();
    if (trimmed === "（无）" || trimmed.toLowerCase() === "(none)") return [];

    const lines = trimmed.split("\n").map((l) => l.trim()).filter(Boolean);
    const jumpers: ParsedJumper[] = [];
    let i = 0;
    let sawFallback = false;

    while (i < lines.length) {
        const headLine = lines[i];

        if (isConditionLine(headLine)) {
            const condition = extractConditionValue(headLine);
            if (condition === null) return null;
            const nextLine = lines[i + 1];
            if (!nextLine) return null;
            const target = parseTargetLine(nextLine);
            if (target === null) return null;
            jumpers.push({ kind: target.kind, condition, target: target.target });
            i += 2;
            continue;
        }

        if (isFallbackLine(headLine)) {
            if (sawFallback) return null;
            const nextLine = lines[i + 1];
            if (!nextLine) return null;
            if (isEndTargetLine(nextLine)) {
                jumpers.push({ kind: "internal", condition: null, target: "" });
            } else {
                const target = parseTargetLine(nextLine);
                if (target === null) return null;
                jumpers.push({ kind: target.kind, condition: null, target: target.target });
            }
            sawFallback = true;
            i += 2;
            continue;
        }

        return null;
    }

    return jumpers;
}

function isConditionLine(line: string): boolean {
    const t = line.replace(/^-\s*/, "");
    return KW_CONDITION.some((k) => t.startsWith(k + "：") || t.startsWith(k + ":"));
}

function isFallbackLine(line: string): boolean {
    const t = line.replace(/^-\s*/, "").trim();
    return t === "否则" || t === "Else" || t === "else";
}

function isEndTargetLine(line: string): boolean {
    const t = line.replace(/^-\s*/, "").trim();
    if (t === "结束" || t === "End" || t === "end") return true;
    return KW_INTERNAL_TARGET.some((k) => {
        const re = new RegExp(`^${escapeRegExp(k)}\\s*[：:]\\s*(结束|End|end)\\s*$`);
        return re.test(t);
    }) || KW_EXTERNAL_TARGET.some((k) => {
        const re = new RegExp(`^${escapeRegExp(k)}\\s*[：:]\\s*(结束|End|end)\\s*$`);
        return re.test(t);
    });
}

function extractConditionValue(line: string): string | null {
    const t = line.replace(/^-\s*/, "");
    for (const k of KW_CONDITION) {
        const re = new RegExp(`^${escapeRegExp(k)}\\s*[：:]\\s*(.+)$`);
        const m = t.match(re);
        if (m) return m[1].trim();
    }
    return null;
}

interface ParsedTarget {
    kind: "internal" | "external";
    target: string;
}

function parseTargetLine(line: string): ParsedTarget | null {
    const t = line.replace(/^-\s*/, "").trim();

    for (const k of KW_INTERNAL_TARGET) {
        const byStep = t.match(new RegExp(`^${escapeRegExp(k)}\\s*[：:]\\s*步骤\\s+(\\d+)\\s*$`));
        if (byStep) return { kind: "internal", target: byStep[1] };
    }

    for (const k of KW_INTERNAL_TARGET) {
        const byName = t.match(new RegExp(`^${escapeRegExp(k)}\\s*[：:]\\s*(.+)$`));
        if (byName) {
            const target = byName[1].trim();
            if (target === "结束" || target === "End" || target === "end") {
                return { kind: "internal", target: "" };
            }
            return { kind: "internal", target };
        }
    }

    for (const k of KW_EXTERNAL_TARGET) {
        const byName = t.match(new RegExp(`^${escapeRegExp(k)}\\s*[：:]\\s*(.+)$`));
        if (byName) return { kind: "external", target: byName[1].trim() };
    }

    return null;
}

// ════════════════════════════════════════════════════════════════════
// 工具函数
// ════════════════════════════════════════════════════════════════════

function escapeRegExp(s: string): string {
    return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function matchKeyword(text: string, keywords: readonly string[]): boolean {
    const t = text.trim();
    return keywords.some((k) => t === k);
}

function headingText(node: Heading): string {
    return plainText(node);
}

function plainText(node: any): string {
    if ("value" in node && typeof node.value === "string") return node.value;
    if ("children" in node && Array.isArray(node.children)) {
        return node.children.map(plainText).join("");
    }
    return "";
}

function snippetOf(nodes: RootContent[], maxLen: number): string {
    const text = nodes.map(plainText).join(" ").replace(/\s+/g, " ").trim();
    return text.length > maxLen ? text.slice(0, maxLen) + "…" : text;
}