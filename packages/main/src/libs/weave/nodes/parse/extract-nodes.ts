/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * weaver · parse · 从格式随意的 markdown 中语义提取工作流
 *
 * 职责：
 * 1. 把 markdown 按二级标题切成 sections
 * 2. 并行对每个 node-section 用 LLM 提取 inputs/outputs/action/jumpers
 * 3. 全局 artifact 名称对齐（同义词归一）
 * 4. 组装为 ParsedNode[] + ParsedGlobalInput[]，供 buildHumanFlow 消费
 */

import { getSmartModel } from "$libs/model/balancer/get-smart-model.js";
import { configService } from "$libs/store/index.js";
import { generateText } from "ai";
import pMap from "p-map";
import remarkParse from "remark-parse";
import { unified } from "unified";
import type { WeaveContext } from "../../context.js";
import type { HumanFlow } from "../../types.js";
import { buildHumanFlowFromParsed } from "./build-flow.js";
import type { ParsedGlobalInput, ParsedJumper, ParsedNode } from "./standard.js";

// ════════════════════════════════════════════════════════════════════
// 入口
// ════════════════════════════════════════════════════════════════════

export interface ExtractResult {
    flow: HumanFlow;
    /** 归一后的全局 artifact 名称映射表（原名 → 归一名），供调试 */
    aliasMap: Map<string, string>;
}

export async function extractWorkflow(
    ctx: WeaveContext,
    doc: string,
    docIndex: number,
): Promise<ExtractResult> {
    ctx.ctx.notify("extract", `doc ${docIndex + 1}：开始语义提取`);

    const rawSections = splitSections(doc);

    const flowName = rawSections.title || `工作流 ${docIndex + 1}`;
    const goal = rawSections.preamble;

    // 全局输入 section
    const globalInputs = rawSections.globalInputSection
        ? await extractGlobalInputs(ctx, rawSections.globalInputSection)
        : [];

    // 并行提取各节点
    const extracted = await pMap(
        rawSections.nodeSections,
        (sec) => extractNodeSection(ctx, sec),
        { concurrency: configService().get("concurrency") },
    );

    ctx.ctx.notify("extract", `doc ${docIndex + 1}：提取完成，共 ${extracted.length} 个节点，开始对齐`);

    // 收集全部 artifact 名（提取阶段用原始词汇）
    const allRawNames = collectAllArtifactNames(globalInputs, extracted);

    // 对齐：LLM 归一同义 artifact 名
    const aliasMap = await alignArtifactNames(ctx, allRawNames);

    // 应用对齐映射
    const alignedGlobalInputs = applyAlignToGlobalInputs(globalInputs, aliasMap);
    const alignedNodes = applyAlignToNodes(extracted, aliasMap);

    ctx.ctx.notify("extract", `doc ${docIndex + 1}：对齐完成，构建 HumanFlow`);

    const flow = buildHumanFlowFromParsed(flowName, goal, alignedGlobalInputs, alignedNodes, ctx);

    return { flow, aliasMap };
}

// ════════════════════════════════════════════════════════════════════
// markdown 切 section
// ════════════════════════════════════════════════════════════════════

interface RawSections {
    title: string;
    preamble: string;
    globalInputSection: string | null;
    nodeSections: { heading: string; body: string }[];
}

const GLOBAL_INPUT_KEYWORDS = ["全局输入", "global inputs", "输入材料", "前置输入"];

function splitSections(doc: string): RawSections {
    const tree = unified().use(remarkParse).parse(doc);
    const lines = doc.split("\n");

    let title = "";
    let preamble = "";
    let globalInputSection: string | null = null;
    const nodeSections: { heading: string; body: string }[] = [];

    // const passedH1 = false;
    // const currentHeading: string | null = null;
    // const currentStart = 0;

    // 用 AST 定位各 heading 的行范围，然后切原始文本（保留原始格式供 LLM 阅读）
    const h1s = tree.children.filter((n): n is import("mdast").Heading => n.type === "heading" && n.depth === 1);
    const h2s = tree.children.filter((n): n is import("mdast").Heading => n.type === "heading" && n.depth === 2);

    if (h1s.length > 0) {
        title = extractNodeText(h1s[0]);
        const h1EndLine = h1s[0].position?.end.line ?? 1;

        // preamble：h1 之后到第一个 h2 之前
        const firstH2Line = h2s[0]?.position?.start.line ?? lines.length + 1;
        preamble = lines
            .slice(h1EndLine, firstH2Line - 1)
            .join("\n")
            .replace(/^---\s*$/m, "")
            .trim();
    }

    for (let i = 0; i < h2s.length; i++) {
        const h2 = h2s[i];
        const heading = extractNodeText(h2);
        const startLine = h2.position?.start.line ?? 1;
        const endLine = (h2s[i + 1]?.position?.start.line ?? lines.length + 2) - 1;
        const body = lines.slice(startLine, endLine).join("\n").trim();

        if (GLOBAL_INPUT_KEYWORDS.some((k) => heading.toLowerCase().includes(k.toLowerCase()))) {
            globalInputSection = body;
        } else {
            // 去掉标题中的序号前缀（"1. 收集资料" → "收集资料"），序号不重要
            const cleanHeading = heading.replace(/^\d+[.\s]+/, "").trim();
            nodeSections.push({ heading: cleanHeading, body });
        }
    }

    return { title, preamble, globalInputSection, nodeSections };
}

function extractNodeText(node: import("mdast").Heading): string {
    function getText(n: import("mdast").PhrasingContent | import("mdast").Heading): string {
        if ("value" in n && typeof (n as any).value === "string") return (n as any).value;
        if ("children" in n) return (n as any).children.map(getText).join("");
        return "";
    }
    return getText(node);
}

// ════════════════════════════════════════════════════════════════════
// 全局输入提取
// ════════════════════════════════════════════════════════════════════

async function extractGlobalInputs(
    ctx: WeaveContext,
    sectionBody: string,
): Promise<ParsedGlobalInput[]> {
    const { text } = await generateText({
        model: getSmartModel(undefined, ctx.ctx),
        instructions: GLOBAL_INPUT_INSTRUCTIONS,
        prompt: `从以下内容中提取所有全局输入项，每行一个，格式：\`名称\`（若有默认值则在后面加：默认值=xxx）\n\n${sectionBody}`,
    });

    return parseGlobalInputLines(text);
}

function parseGlobalInputLines(text: string): ParsedGlobalInput[] {
    const results: ParsedGlobalInput[] = [];
    for (const line of text.split("\n")) {
        const trimmed = line.trim();
        if (!trimmed) continue;

        // 匹配反引号内的名称
        const nameMatch = trimmed.match(/`([^`]+)`/);
        if (!nameMatch) continue;

        const key = nameMatch[1];
        const defaultMatch = trimmed.match(/默认值\s*[=＝：:]\s*(.+)$/);
        if (defaultMatch) {
            results.push({ key, hasDefault: true, defaultValue: defaultMatch[1].trim() });
        } else {
            results.push({ key, hasDefault: false });
        }
    }
    return results;
}

const GLOBAL_INPUT_INSTRUCTIONS = `你是工作流分析助手。从给定文本中识别所有全局输入项（工作流开始前需要提供的材料、数据、配置）。
输出格式：每行一个，用反引号包裹名称，若有默认值则追加"默认值=xxx"。
不要输出 JSON，不要输出解释。`;

// ════════════════════════════════════════════════════════════════════
// 节点提取
// ════════════════════════════════════════════════════════════════════

interface RawExtractedNode {
    name: string;
    intent: string;
    inputs: string[];
    outputs: string[];
    action: string;
    jumpers: ParsedJumper[];
}

async function extractNodeSection(
    ctx: WeaveContext,
    sec: { heading: string; body: string },
): Promise<RawExtractedNode> {
    const { text } = await generateText({
        model: getSmartModel(undefined, ctx.ctx),
        instructions: NODE_EXTRACT_INSTRUCTIONS,
        prompt: buildNodePrompt(sec.heading, sec.body),
    });

    return parseNodeExtractResult(sec.heading, text);
}

function buildNodePrompt(heading: string, body: string): string {
    return `## 节点名称
${heading}

## 节点内容
${body}

## 提取要求
按如下格式输出，每项一行，严格使用这些标签：

目的：<这个节点的意图，一句话>
输入：<用反引号列举所有输入产物，空格分隔，如 \`用户需求\` \`历史记录\`，若无则写"无">
输出：<用反引号列举所有输出产物，空格分隔，若无则写"无">
动作：<执行者做了什么，一句话>
跳转：<若有条件跳转，每条一行，格式"条件=xxx 目标=节点名"；若是外部图跳转则"条件=xxx 外部目标=图名"；若无跳转则写"无">`;
}

function parseNodeExtractResult(nodeName: string, text: string): RawExtractedNode {
    const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);

    let intent = "";
    const inputs: string[] = [];
    const outputs: string[] = [];
    let action = "";
    const jumpers: ParsedJumper[] = [];

    for (const line of lines) {
        if (line.startsWith("目的：") || line.startsWith("目的:")) {
            intent = line.replace(/^目的[：:]\s*/, "").trim();
        } else if (line.startsWith("输入：") || line.startsWith("输入:")) {
            const raw = line.replace(/^输入[：:]\s*/, "").trim();
            if (raw !== "无") inputs.push(...extractBacktickNames(raw));
        } else if (line.startsWith("输出：") || line.startsWith("输出:")) {
            const raw = line.replace(/^输出[：:]\s*/, "").trim();
            if (raw !== "无") outputs.push(...extractBacktickNames(raw));
        } else if (line.startsWith("动作：") || line.startsWith("动作:")) {
            action = line.replace(/^动作[：:]\s*/, "").trim();
        } else if (line.startsWith("跳转：") || line.startsWith("跳转:")) {
            const raw = line.replace(/^跳转[：:]\s*/, "").trim();
            if (raw !== "无") {
                const jp = parseJumperLine(raw);
                if (jp) jumpers.push(jp);
            }
        } else {
            // 多行跳转
            const jp = parseJumperLine(line);
            if (jp) jumpers.push(jp);
        }
    }

    return { name: nodeName, intent: intent || nodeName, inputs, outputs, action: action || nodeName, jumpers };
}

function extractBacktickNames(text: string): string[] {
    const names: string[] = [];
    const re = /`([^`]+)`/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) names.push(m[1]);
    // 若 LLM 没用反引号，退化为逗号/空格分割
    if (names.length === 0) {
        return text.split(/[,，、\s]+/).map((s) => s.trim()).filter(Boolean);
    }
    return names;
}

function parseJumperLine(line: string): ParsedJumper | null {
    // 外部跳转：条件=xxx 外部目标=图名
    const extMatch = line.match(/条件\s*[=＝]\s*(.+?)\s+外部目标\s*[=＝]\s*(.+)/);
    if (extMatch) {
        return { kind: "external", condition: extMatch[1].trim(), target: extMatch[2].trim() };
    }
    // 内部跳转：条件=xxx 目标=节点名
    const intMatch = line.match(/条件\s*[=＝]\s*(.+?)\s+目标\s*[=＝]\s*(.+)/);
    if (intMatch) {
        return { kind: "internal", condition: intMatch[1].trim(), target: intMatch[2].trim() };
    }
    return null;
}

const NODE_EXTRACT_INSTRUCTIONS = `你是工作流节点分析助手。从给定节点内容中提取结构信息。
- 输入/输出必须用反引号包裹名称
- 动作是执行者在这个节点实际做的事，用主谓宾形式描述
- 跳转只在有明确条件分支或外部调用时才填写
- 严禁输出 JSON，必须按指定标签格式输出`;

// ════════════════════════════════════════════════════════════════════
// artifact 名称对齐
// ════════════════════════════════════════════════════════════════════

function collectAllArtifactNames(
    globalInputs: ParsedGlobalInput[],
    nodes: RawExtractedNode[],
): string[] {
    const names = new Set<string>();
    for (const gi of globalInputs) names.add(gi.key);
    for (const node of nodes) {
        for (const n of node.inputs) names.add(n);
        for (const n of node.outputs) names.add(n);
    }
    return [...names];
}

async function alignArtifactNames(
    ctx: WeaveContext,
    names: string[],
): Promise<Map<string, string>> {
    if (names.length === 0) return new Map();

    const { text } = await generateText({
        model: getSmartModel(undefined, ctx.ctx),
        instructions: ALIGN_INSTRUCTIONS,
        prompt: buildAlignPrompt(names),
    });

    return parseAlignResult(names, text);
}

function buildAlignPrompt(names: string[]): string {
    return `以下是从一份工作流文档中提取的所有产物名称（artifact），其中可能有不同措辞指代同一事物：

${names.map((n, i) => `${i + 1}. ${n}`).join("\n")}

请识别语义相同的名称并归一化，输出格式：
- 每组同义词一行
- 格式：归一名 <- 原名1, 原名2, ...
- 若某个名称没有同义词，则不需要列出（保持原名不变）
- 归一名选择最清晰、最规范的那个

若没有任何需要合并的名称，输出"无需对齐"。`;
}

function parseAlignResult(originalNames: string[], text: string): Map<string, string> {
    const map = new Map<string, string>();

    if (text.trim() === "无需对齐" || text.trim() === "") return map;

    for (const line of text.split("\n")) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith("#")) continue;

        // 格式：归一名 <- 原名1, 原名2
        const m = trimmed.match(/^(.+?)\s*<-\s*(.+)$/);
        if (!m) continue;

        const canonical = m[1].trim().replace(/^`|`$/g, "");
        const aliases = m[2].split(/[,，]/).map((s) => s.trim().replace(/^`|`$/g, "")).filter(Boolean);

        for (const alias of aliases) {
            if (alias !== canonical && originalNames.includes(alias)) {
                map.set(alias, canonical);
            }
        }
    }

    return map;
}

const ALIGN_INSTRUCTIONS = `你是工作流产物名称对齐助手。识别语义相同的产物名称并给出归一化映射。
严格按照"归一名 <- 原名1, 原名2"格式输出，不要输出 JSON，不要解释。`;

// ════════════════════════════════════════════════════════════════════
// 应用对齐映射
// ════════════════════════════════════════════════════════════════════

function applyAlignToGlobalInputs(
    inputs: ParsedGlobalInput[],
    aliasMap: Map<string, string>,
): ParsedGlobalInput[] {
    return inputs.map((gi) => ({
        ...gi,
        key: aliasMap.get(gi.key) ?? gi.key,
    }));
}

function applyAlignToNodes(
    nodes: RawExtractedNode[],
    aliasMap: Map<string, string>,
): ParsedNode[] {
    return nodes.map((node, i) => ({
        order: i + 1,
        name: node.name,
        intent: node.intent,
        inputs: node.inputs.map((n) => aliasMap.get(n) ?? n),
        outputs: node.outputs.map((n) => aliasMap.get(n) ?? n),
        action: node.action,
        jumpers: node.jumpers.map((jp) => ({
            ...jp,
            // 内部跳转目标是节点名，不走 artifact 对齐
            target: jp.kind === "internal" ? jp.target : jp.target,
        })),
    }));
}