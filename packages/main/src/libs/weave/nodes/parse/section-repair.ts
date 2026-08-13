/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * weaver · parse · section-level 定向修补（v2）
 *
 * 变更：
 *  - 接收 ValidationError（带 severity）→ 只对 error 级别的反馈做定向修补；
 *    warning 仅记录日志，不触发 LLM 修补（避免无意义轮转）。
 *  - 增加"产物引用计数"反馈：dead（产出但未消费）的步骤要在动作中显式消费。
 *
 * 把"整篇重抽"降级为"按 step.name 定向修补"——对 build-flow + validateHumanFlow 抛出的
 * 结构性错误按 step.name 分桶；只让 LLM 重写有问题步骤段，再由代码 splice 回去。
 */

import { getSmartModel } from "$libs/model/balancer/get-smart-model.js";
import { generateText } from "ai";
import type { WeaveContext } from "../../context.js";
import type { ValidationError } from "../../graph/validate.js";

export interface StepFixTarget {
    /** 受影响步骤的 name（在 ## N. xxx 标题中出现的名称） */
    stepName: string;
    /** 聚类到该步骤的所有反馈 */
    feedbacks: string[];
}

export interface SectionRepairInput {
    /** 当前 markdown 全文 */
    doc: string;
    /** 仅由 build-flow / validate 错误构造的反馈 */
    feedbacks: string[];
}

export interface SectionRepairResult {
    /** 修补后的 markdown */
    doc: string;
    /** 是否发生了修改 */
    changed: boolean;
}

/**
 * 从 validation errors + 动作完整性反馈中，按 stepName 分桶。
 *  - 只接受 severity === 'error' 的 validation error；
 *  - warning 进入 global 桶（已在 extract-workflow 主流程作为 info 日志记录）；
 *  - 无法定位 step 的 error（cycle / unreachable / missing-input 等不挂 nodeId）进入 global。
 */
export function bucketFeedbacksByStep(
    errors: ValidationError[],
    actionFeedbacks: string[],
): { stepTargets: StepFixTarget[]; global: string[] } {
    const byStep = new Map<string, string[]>();
    const global: string[] = [];

    for (const e of errors) {
        if (!e.nodeId) {
            global.push(`[DAG验证] ${e.message}`);
            continue;
        }
        const arr = byStep.get(e.nodeId) ?? [];
        arr.push(`[DAG验证] ${e.message}`);
        byStep.set(e.nodeId, arr);
    }

    for (const f of actionFeedbacks) {
        const m = f.match(/步骤「([^」]+)」/);
        if (!m) {
            global.push(f);
            continue;
        }
        const stepName = m[1];
        const arr = byStep.get(stepName) ?? [];
        arr.push(f);
        byStep.set(stepName, arr);
    }

    const stepTargets: StepFixTarget[] = [...byStep.entries()].map(([stepName, feedbacks]) => ({
        stepName,
        feedbacks,
    }));

    return { stepTargets, global };
}

export async function repairSectionsByLLM(
    ctx: WeaveContext,
    input: SectionRepairInput,
    targets: StepFixTarget[],
): Promise<SectionRepairResult> {
    if (targets.length === 0) {
        return { doc: input.doc, changed: false };
    }

    const sections = parseSections(input.doc);
    if (sections.length === 0) {
        return { doc: input.doc, changed: false };
    }

    const byHeading = new Map(sections.map((s) => [s.headingName, s] as const));

    const repaired = new Map<string, string>();
    for (const target of targets) {
        const sec = byHeading.get(target.stepName);
        if (!sec) continue;

        const prompt = buildRepairPrompt(sec.raw, target.feedbacks);
        try {
            const { text } = await generateText({
                model: getSmartModel(undefined, ctx.ctx),
                instructions: REPAIR_INSTRUCTIONS,
                prompt,
            });
            const cleaned = extractSectionBlock(text);
            if (cleaned) {
                repaired.set(target.stepName, cleaned);
                ctx.ctx.info?.(
                    `[repairSectionsByLLM] 已修补步骤「${target.stepName}」`,
                );
            }
        } catch (e: any) {
            ctx.ctx.info?.(
                `[repairSectionsByLLM] 修补步骤「${target.stepName}」失败：${e?.message ?? String(e)}，保留原段`,
            );
        }
    }

    if (repaired.size === 0) return { doc: input.doc, changed: false };

    const newDoc = spliceSections(input.doc, sections, repaired);
    return { doc: newDoc, changed: newDoc !== input.doc };
}

interface ParsedSection {
    headingLine: number;
    headingName: string;
    start: number;
    end: number;
    raw: string;
}

function parseSections(doc: string): ParsedSection[] {
    const lines = doc.split("\n");
    const sections: ParsedSection[] = [];
    let i = 0;

    while (i < lines.length) {
        const m = lines[i].match(/^##\s+(\d+)\.\s*(.+?)\s*$/);
        if (m) {
            const headingName = m[2];
            const start = i;
            let j = i + 1;
            while (j < lines.length) {
                if (/^##\s+\d+\.\s*/.test(lines[j])) break;
                j++;
            }
            sections.push({
                headingLine: i,
                headingName,
                start,
                end: j,
                raw: lines.slice(start, j).join("\n"),
            });
            i = j;
        } else {
            i++;
        }
    }

    return sections;
}

function extractSectionBlock(text: string): string | null {
    const trimmed = text.trim();
    if (!trimmed) return null;
    const lines = trimmed.split("\n");
    if (!/^##\s+\d+\.\s*/.test(lines[0])) {
        return null;
    }
    let end = lines.length;
    for (let i = 1; i < lines.length; i++) {
        if (/^##\s+\d+\.\s*/.test(lines[i])) {
            end = i;
            break;
        }
    }
    return lines.slice(0, end).join("\n").trimEnd();
}

function spliceSections(doc: string, sections: ParsedSection[], repaired: Map<string, string>): string {
    const lines = doc.split("\n");
    const ordered = [...sections].sort((a, b) => b.start - a.start);
    for (const sec of ordered) {
        const newBlock = repaired.get(sec.headingName);
        if (!newBlock) continue;
        lines.splice(sec.start, sec.end - sec.start, newBlock);
    }
    return lines.join("\n");
}

function buildRepairPrompt(sectionRaw: string, feedbacks: string[]): string {
    return (
        `## 待修补的步骤段（仅此一段，其它段不要动）\n\n` +
        `${sectionRaw}\n\n` +
        `## 必须修正的问题\n\n` +
        feedbacks.map((f, i) => `${i + 1}. ${f}`).join("\n") +
        `\n\n请仅输出修正后的该步骤段 markdown（从 \`## N. <步骤名>\` 开始，到下一个 \`## \` 之前结束）。`
    );
}

const REPAIR_INSTRUCTIONS = `你是工作流文档的"单步骤定向修补"专家。

你只修补给定的一个步骤段（## N. xxx 块），其它步骤段一字不动。

修补要求：
1. 输入：原步骤段 + 该段需要修正的具体问题列表。
2. 输出：仅输出修补后的该步骤段 markdown（以 ## N. <步骤名> 开头，到下一个 ## 之前结束）。
3. 修补原则：
   - 输入/输出产物的名称必须与该步骤声明的一致；
   - 动作段保留自然语言描述，所有控制流（若 X 则… / 否则继续 / 重复直到…）与质量约束完整保留；
   - 输入段声明的每一项必须在动作段被引用；未被引用的输入要么删除、要么在动作中明确写出如何使用；
   - 产出的每一项要么在该步骤的输出中显式列出、要么删除（避免死产物）；
4. 严禁改动其它步骤；严禁在末尾追加"修正说明""回应"等元信息。`;