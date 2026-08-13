/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * weaver · parse · 语义自检（v14）
 *
 * 变更：
 * - 同名对齐：去掉字符 jaccard 启发式，改用 fuse.js（vm 沙箱 fixedpkgs 注入，v7.5）
 *   跨步骤产物名模糊匹配：频次 =1 的低频名对频次 ≥2 的高频名索引做查询，
 *   score ≤ 0.35 视为疑似别名并报告。
 * - 保留三项内部校验（不调 LLM，纯 mdast + 正则）：
 *   1. 完整性：每步输入/输出/动作三项必填
 *   2. 可行性：动作段不能为空、不能含 TODO/未完成标记
 *   3. 名称对齐：fuse.js 模糊匹配（替代原 jaccard）
 */

import type { Heading, List, ListItem, Root, RootContent } from "mdast";
import remarkParse from "remark-parse";
import { unified } from "unified";
import type { WeaveContext } from "../../context.js";

/** fuse.js score 越低越相似；0.35 对中文产物名"看起来是同一概念但写法略不同"较稳 */
const FUSE_ALIGN_THRESHOLD = 0.35;

/** 至少出现 2 次才作为高频锚点（避免对唯一出现的名字做无意义比对） */
const HIGH_FREQ_MIN_COUNT = 2;

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

    // 4. 名称对齐检查（fuse.js）
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
 * 名称对齐检查（fuse.js 版）：
 * - 收集所有出现过的产物名（输入 + 输出段），统计频次
 * - 对每个低频名（=1），用 fuse 在高频名（≥2）上做模糊查询
 * - score ≤ 阈值即视为疑似别名，报告让模型统一名称
 */
function checkNameAlignment(steps: StepSection[]): string[] {
    const issues: string[] = [];

    const Fuse = (globalThis as any).Fuse;
    if (typeof Fuse !== "function") {
        // fuse.js 未注入：跳过此项校验（不阻塞流程）
        return issues;
    }

    const namesByStep: string[][] = [];
    for (const sec of steps) {
        const fields = extractListFields(sec.body);
        const allText = `${fields["输入"] ?? ""} ${fields["输出"] ?? ""}`;
        namesByStep.push(splitToPhrases(allText));
    }

    const freq = new Map<string, number>();
    for (const names of namesByStep) {
        for (const n of names) freq.set(n, (freq.get(n) ?? 0) + 1);
    }

    const highFreq = [...freq.entries()]
        .filter(([, c]) => c >= HIGH_FREQ_MIN_COUNT)
        .map(([n]) => n);
    if (highFreq.length === 0) return issues;

    const fuse = new Fuse(highFreq, {
        threshold: FUSE_ALIGN_THRESHOLD,
        includeScore: true,
        ignoreLocation: true,
    });

    for (let i = 0; i < steps.length; i++) {
        const stepName = steps[i].heading?.replace(/^\d+\.\s*/, "").trim() ?? `步骤${i + 1}`;
        for (const name of namesByStep[i]) {
            if ((freq.get(name) ?? 0) >= HIGH_FREQ_MIN_COUNT) continue;
            const hits = fuse.search(name);
            const best = hits[0];
            if (!best || best.score == null) continue;
            if (best.score <= FUSE_ALIGN_THRESHOLD && best.item !== name) {
                issues.push(
                    `步骤「${stepName}」使用了名词「${name}」（仅出现 1 次），` +
                    `与其他步骤中的高频名词「${best.item}」高度相似（fuse score=${best.score.toFixed(2)}）。` +
                    `请统一名称。`,
                );
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

function plainText(node: any): string {
    if ("value" in node && typeof node.value === "string") return node.value;
    if ("children" in node && Array.isArray(node.children)) {
        return node.children.map(plainText).join("");
    }
    return "";
}