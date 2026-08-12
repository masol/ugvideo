/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * weaver · parse · 标准格式校验 + 构造 HumanFlow
 */

import type { Heading, List, ListItem, Root, RootContent } from "mdast";
import remarkParse from "remark-parse";
import { unified } from "unified";
import type { WeaveContext } from "../../context.js";
import type { HumanFlow } from "../../types.js";
import { buildHumanFlowFromParsed } from "./build-flow.js";
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
    errors: string[];
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

export interface ParsedNode {
    order: number;
    name: string;
    intent: string;
    inputs: string[];
    outputs: string[];
    action: string;
    jumpers: ParsedJumper[];
}

export interface FlowSection {
    heading: string | null;
    body: RootContent[];
}

/** 解析 markdown 为 AST */
export function parseMarkdown(markdown: string): Root {
    return unified().use(remarkParse).parse(markdown);
}

/** 尝试解析标准格式，无论成功失败都尽量返回已收集的 sections */
export function tryStandard(tree: Root, ctx: WeaveContext): StandardResult {
    const errors: string[] = [];

    const h1Nodes = tree.children.filter(
        (n): n is Heading => n.type === "heading" && n.depth === 1,
    );
    if (h1Nodes.length !== 1) {
        errors.push("必须恰好 1 个一级标题");
        return { flow: null, errors, sections: null };
    }

    const flowName = headingText(h1Nodes[0]);
    if (!flowName) {
        errors.push("一级标题为空");
        return { flow: null, errors, sections: null };
    }

    const allSections = collectFlowSections(tree.children);
    const goal = extractGoal(allSections.preSteps);

    const globalInputSection = allSections.sections.find(
        (s) => s.heading && matchKeyword(s.heading, KW_GLOBAL_INPUTS),
    );
    const globalInputs: ParsedGlobalInput[] = globalInputSection
        ? parseGlobalInputs(globalInputSection.body) ?? []
        : [];

    const stepSections = allSections.sections.filter(
        (s) => s.heading && /^\d+\.\s*.+/.test(s.heading),
    );

    if (stepSections.length === 0) {
        errors.push("至少需要 1 个步骤");
        return {
            flow: null,
            errors,
            sections: { flowName, goal, globalInputs, parsedNodes: [], rawStepSections: [] },
        };
    }

    const parsedNodes: ParsedNode[] = [];
    let hasNodeError = false;

    for (const sec of stepSections) {
        const node = parseStandardNode(sec);
        if (!node) {
            errors.push(`节点「${sec.heading}」格式非法`);
            hasNodeError = true;
            continue;
        }
        parsedNodes.push(node);
    }

    const sections: CollectedSections = {
        flowName,
        goal,
        globalInputs,
        parsedNodes,
        rawStepSections: stepSections,
    };

    if (hasNodeError) {
        return { flow: null, errors, sections };
    }

    for (let i = 0; i < parsedNodes.length; i++) {
        if (parsedNodes[i].order !== i + 1) {
            errors.push(`节点序号不连续：期望 ${i + 1}，实际 ${parsedNodes[i].order}`);
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
            current = { heading: headingText(node), body: [] };
            sections.push(current);
            continue;
        }

        if (current) {
            current.body.push(node);
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

function parseGlobalInputs(body: RootContent[]): ParsedGlobalInput[] | null {
    const inputs: ParsedGlobalInput[] = [];
    for (const node of body) {
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
// 节点解析 —— 句法驱动
// ════════════════════════════════════════════════════════════════════

const REQUIRED_NODE_FIELDS: string[][] = [KW_PURPOSE, KW_INPUTS, KW_OUTPUTS, KW_ACTION];

function parseStandardNode(section: FlowSection): ParsedNode | null {
    const m = section.heading!.match(/^(\d+)\.\s*(.+)$/);
    if (!m) return null;

    const order = parseInt(m[1], 10);
    const name = m[2].trim();

    const fields = extractListFields(section.body);
    if (!fields) return null;

    for (const required of REQUIRED_NODE_FIELDS) {
        if (!(required[0] in fields)) return null;
    }

    const inputs = parseArtifactList(fields[KW_INPUTS[0]]);
    const outputs = parseArtifactList(fields[KW_OUTPUTS[0]]);
    if (inputs === null || outputs === null) return null;

    const jumpers: ParsedJumper[] = [];
    if (fields[KW_JUMPS[0]]) {
        const jps = parseJumperList(fields[KW_JUMPS[0]]);
        if (jps === null) return null;
        jumpers.push(...jps);
    }

    return {
        order,
        name,
        intent: fields[KW_PURPOSE[0]].trim(),
        inputs,
        outputs,
        action: fields[KW_ACTION[0]].trim(),
        jumpers,
    };
}

function extractListFields(body: RootContent[]): Record<string, string> | null {
    const fields: Record<string, string> = {};
    for (const node of body) {
        if (node.type !== "list" || node.ordered) return null;
        for (const item of node.children) {
            const parsed = parseFieldItem(item);
            if (!parsed) return null;
            fields[parsed.key] = parsed.value;
        }
    }
    return fields;
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
    const names: string[] = [];
    const re = /`([^`]+)`/g;
    let m: RegExpExecArray | null;
    let lastIndex = 0;
    while ((m = re.exec(text)) !== null) {
        if (m.index !== lastIndex) {
            const between = text.slice(lastIndex, m.index).trim();
            if (between) return null;
        }
        names.push(m[1]);
        lastIndex = re.lastIndex;
    }
    if (lastIndex !== text.length) {
        const tail = text.slice(lastIndex).trim();
        if (tail) return null;
    }
    return names;
}

// ════════════════════════════════════════════════════════════════════
// 跳转解析
// ════════════════════════════════════════════════════════════════════

function parseJumperList(text: string): ParsedJumper[] | null {
    const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);
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
    return new RegExp(`^-\\s*${escapeRegExp(KW_CONDITION[0])}\\s*[：:]\\s*`).test(line);
}

function isFallbackLine(line: string): boolean {
    return /^-\s*否则\s*$/.test(line) || /^-\s*否则\s*[：:]\s*$/.test(line);
}

function isEndTargetLine(line: string): boolean {
    return /^-\s*结束\s*$/.test(line)
        || new RegExp(`^-\\s*${escapeRegExp(KW_INTERNAL_TARGET[0])}\\s*[：:]\\s*结束\\s*$`).test(line)
        || new RegExp(`^-\\s*${escapeRegExp(KW_EXTERNAL_TARGET[0])}\\s*[：:]\\s*结束\\s*$`).test(line);
}

function extractConditionValue(line: string): string | null {
    const m = line.match(new RegExp(`^-\\s*${escapeRegExp(KW_CONDITION[0])}\\s*[：:]\\s*(.+)$`));
    return m ? m[1].trim() : null;
}

interface ParsedTarget {
    kind: "internal" | "external";
    target: string;
}

function parseTargetLine(line: string): ParsedTarget | null {
    const internalByStep = line.match(
        new RegExp(`^-\\s*${escapeRegExp(KW_INTERNAL_TARGET[0])}\\s*[：:]\\s*步骤\\s+(\\d+)\\s*$`),
    );
    if (internalByStep) return { kind: "internal", target: internalByStep[1] };

    const internalByName = line.match(
        new RegExp(`^-\\s*${escapeRegExp(KW_INTERNAL_TARGET[0])}\\s*[：:]\\s*(.+)$`),
    );
    if (internalByName) return { kind: "internal", target: internalByName[1].trim() };

    const external = line.match(
        new RegExp(`^-\\s*${escapeRegExp(KW_EXTERNAL_TARGET[0])}\\s*[：:]\\s*(.+)$`),
    );
    if (external) return { kind: "external", target: external[1].trim() };

    return null;
}

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