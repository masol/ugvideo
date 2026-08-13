/**
 * weaver · parse · 提取入口（v5.1）
 *
 * 本次仅修复 normalize() 中 ParsedGlobalInput 类型不兼容的 TS 编译错误；
 * 其余语义、自检、sanitizer、修补逻辑均与 v5 完全一致。
 */

import { safefmt } from "$libs/model/llm/outline.js";
import type { ModelMessage } from "ai";
import { Output } from "ai";
import { z } from "zod";
import type { WeaveContext } from "../../context.js";
import { blockingErrors, validateHumanFlow } from "../../graph/validate.js";
import type { HumanFlow } from "../../types.js";
import { checkActionCompleteness } from "./action-completeness.js";
import type { ArtifactRegistry } from "./build-flow.js";
import { applyArtifactSemantics, buildHumanFlowFromParsed } from "./build-flow.js";
import { extractArtifactSemantics } from "./extract-artifact-semantics.js";
import type { ArtifactSemantic, ParsedGlobalInput, ParsedNode } from "./parse-types.js";
import { renderStandardDoc } from "./render-standard.js";
import { bucketFeedbacksByStep, repairSectionsByLLM } from "./section-repair.js";
import { semanticRefine } from "./semantic-refine.js";

// ════════════════════════════════════════════════════════════════════
// 类型定义
// ════════════════════════════════════════════════════════════════════

export interface ArtifactReport {
    orphans: { name: string; consumedBy: string[] }[];
    dead: { name: string; producedBy: string }[];
    total: number;
}

export interface CachedWorkflow {
    flowName: string;
    goal: string;
    globalInputs: ParsedGlobalInput[];
    nodes: ParsedNode[];
    artifactSemantics: ArtifactSemantic[];
}

export interface ExtractResult {
    flow: HumanFlow;
    standardDoc: string;
    cached: CachedWorkflow;
    artifactReport: ArtifactReport;
}

export interface ExtractOptions {
    goal?: string | null;
    constraints?: string | null;
    preferences?: string | null;
}

// ════════════════════════════════════════════════════════════════════
// safefmt 抽取 schema
// ════════════════════════════════════════════════════════════════════

const GlobalInputSchema = z.object({
    key: z.string().describe("全局输入项 / 配置项的名称，直接沿用原文中的叫法。"),
    hasDefault: z.boolean().describe("是否为带固定内容的配置项。"),
    defaultValue: z.string().describe("配置项的【完整逐字内容】。hasDefault=false 时填空字符串。"),
});

const ExtractedNodeSchema = z.object({
    order: z.number().int().describe("步骤序号，从 1 开始的连续整数，不得跳号或重复。"),
    name: z.string().describe("步骤名称，简洁的动宾短语，全流程内唯一。"),
    intent: z.string().describe("本步骤的业务目的。"),
    inputs: z.array(z.string()).describe("输入产物 / 配置项名称列表，逐字一致。"),
    outputs: z.array(z.string()).describe("产出产物名称列表，逐字一致。"),
    action: z
        .string()
        .describe(
            "完整可执行动作描述，主谓宾齐全，保留所有控制流与质量约束。" +
            "动作中引用的产物 / 配置项名称必须与本步骤 inputs/outputs 或全局配置项里的名称逐字一致，并用反引号包裹。",
        ),
});

const WorkflowSchema = z.object({
    flowName: z.string().describe("工作流名称。"),
    goal: z.string().describe("工作流总目标。"),
    globalInputs: z.array(GlobalInputSchema).describe("全局输入项与配置项。"),
    nodes: z.array(ExtractedNodeSchema).describe("按执行顺序排列的所有步骤。"),
});

type ExtractedWorkflow = z.infer<typeof WorkflowSchema>;

// ════════════════════════════════════════════════════════════════════
// 入口
// ════════════════════════════════════════════════════════════════════

export async function extractWorkflow(
    ctx: WeaveContext,
    doc: string,
    docIndex: number,
    options: ExtractOptions = {},
): Promise<ExtractResult> {
    ctx.ctx.notify("extract", `doc ${docIndex + 1}：开始语义整理`);

    const maxRounds = ctx.storage.config.getMaxReactRounds();
    let lastFeedback: string[] = [];
    let lastSemanticMessages: ModelMessage[] | undefined;
    let workingDoc: string = doc;

    for (let round = 0; round < maxRounds; round++) {
        ctx.ctx.notify(
            "extract",
            `doc ${docIndex + 1} 第 ${round + 1}/${maxRounds} 轮：语义整理`,
        );

        const refine = await semanticRefine(
            ctx,
            workingDoc,
            options.goal ?? null,
            options.constraints ?? null,
            options.preferences ?? null,
            lastFeedback,
            lastSemanticMessages,
        );
        const semanticDoc = refine.doc;
        lastSemanticMessages = refine.messages;
        workingDoc = semanticDoc;

        ctx.ctx.info?.(
            `[extract] doc ${docIndex + 1} round ${round + 1} 语义整理完成，长度 ${semanticDoc.length}`,
        );

        const extracted = await extractStructured(ctx, semanticDoc);
        if (!extracted || extracted.nodes.length === 0) {
            lastFeedback = [
                "[结构化抽取] 无法从整理结果中抽取出完整的工作流步骤，请让每个步骤的名称、输入、输出、动作更清晰、更明确、更完整。",
            ];
            ctx.ctx.notify(
                "extract",
                `doc ${docIndex + 1} 第 ${round + 1} 轮：结构化抽取失败，回退语义整理`,
            );
            continue;
        }

        const cached = normalize(extracted);
        if (cached.nodes.length === 0) {
            lastFeedback = ["[结构化抽取] 未抽取到任何有效步骤，请确保文档中的每个步骤都清晰可辨。"];
            ctx.ctx.notify(
                "extract",
                `doc ${docIndex + 1} 第 ${round + 1} 轮：无有效步骤，回退语义整理`,
            );
            continue;
        }

        const actionIssues = checkActionCompleteness(cached.nodes, cached.globalInputs);
        const flow = buildHumanFlowFromParsed(
            cached.flowName,
            cached.goal,
            cached.globalInputs,
            cached.nodes,
            ctx,
        );

        const validationAll = validateHumanFlow(flow, ctx.conceptManager);
        const validationErrors = blockingErrors(validationAll);
        const warnings = validationAll.filter((e) => e.severity === "warning");

        const registry = (flow as HumanFlow & { _artifactRegistry?: ArtifactRegistry })
            ._artifactRegistry;

        const artifactReport: ArtifactReport = registry
            ? {
                orphans: registry.orphans.map((name) => ({
                    name,
                    consumedBy: [...(registry.consumers.get(name) ?? [])],
                })),
                dead: registry.dead.map((name) => ({
                    name,
                    producedBy: registry.producer.get(name) ?? "",
                })),
                total: registry.all.size,
            }
            : { orphans: [], dead: [], total: 0 };

        if (warnings.length > 0) {
            ctx.ctx.info?.(
                `[extract] doc ${docIndex + 1} round ${round + 1} 警告：${warnings.map((w) => w.message).join("；")}`,
            );
        }

        if (
            validationErrors.length === 0 &&
            artifactReport.orphans.length === 0 &&
            actionIssues.length === 0
        ) {
            const names = collectArtifactNames(cached);
            const artifactSemantics = await extractArtifactSemantics(ctx, semanticDoc, names);
            applyArtifactSemantics(ctx, artifactSemantics);
            cached.artifactSemantics = artifactSemantics;

            const standardDoc = renderStandardDoc(
                cached.flowName,
                cached.goal,
                cached.globalInputs,
                cached.nodes,
            );
            ctx.ctx.notify("extract", `doc ${docIndex + 1} 第 ${round + 1} 轮：验证通过`);
            return { flow, standardDoc, cached, artifactReport };
        }

        const bucketed = bucketFeedbacksByStep(validationErrors, actionIssues);
        const artifactFeedback = formatArtifactFeedback(artifactReport);
        const allGlobal = [
            ...bucketed.global,
            ...artifactFeedback,
            ...warnings.map((w) => `[结构警告] ${w.message}`),
        ];

        const repair = await repairSectionsByLLM(
            ctx,
            { doc: semanticDoc, feedbacks: [] },
            bucketed.stepTargets,
        );

        if (repair.changed) {
            ctx.ctx.notify(
                "extract",
                `doc ${docIndex + 1} 第 ${round + 1} 轮：section 修补 ${bucketed.stepTargets.length} 个步骤，重新抽取`,
            );
            workingDoc = repair.doc;
            lastFeedback = allGlobal;
            lastSemanticMessages = undefined;
            continue;
        }

        lastFeedback = [
            ...bucketed.stepTargets.flatMap((t) => t.feedbacks),
            ...allGlobal,
        ];
        ctx.ctx.notify(
            "extract",
            `doc ${docIndex + 1} 第 ${round + 1} 轮：${lastFeedback.length} 条反馈回灌语义整理`,
        );
    }

    throw new Error(
        `[extract] doc ${docIndex} 经 ${maxRounds} 轮 reAct 仍未通过验证：\n${lastFeedback.join("\n")}`,
    );
}

// ════════════════════════════════════════════════════════════════════
// safefmt 抽取
// ════════════════════════════════════════════════════════════════════

async function extractStructured(
    ctx: WeaveContext,
    semanticDoc: string,
): Promise<ExtractedWorkflow | null> {
    const result = await safefmt(
        semanticDoc,
        Output.object({ schema: WorkflowSchema }),
        ctx.ctx,
    );
    if (!result.success || !result.value) return null;
    return result.value.output;
}

// ════════════════════════════════════════════════════════════════════
// 归一化（含 name sanitizer）
// ════════════════════════════════════════════════════════════════════

/**
 * 清净化产物 / 节点 / 全局输入名称：
 *  - 去掉前后空白；
 *  - 去掉所有反引号（U+0060），包括 markdown 反引号转义 "\`"；
 *  - 去掉常见的引号变体（避免 LLM 把 `"`/`'`/`「`/`」`/`《`/`》` 一并塞进 name）；
 *  - 空名直接丢弃；
 *  - 长度上限 50（防御性，避免 KV key 异常膨胀）。
 */
function sanitizeName(raw: unknown): string {
    if (typeof raw !== "string") return "";
    let s = raw.trim();
    s = s.replace(/\\?`/g, "");
    s = s.replace(/["'`´「」『』《》<>]/g, "");
    s = s.trim();
    if (s.length === 0) return "";
    if (s.length > 50) s = s.slice(0, 50).trim();
    return s;
}

function sanitizeNames(arr: unknown): string[] {
    const seen = new Set<string>();
    const out: string[] = [];
    for (const raw of (Array.isArray(arr) ? arr : [])) {
        const t = sanitizeName(raw);
        if (!t || seen.has(t)) continue;
        seen.add(t);
        out.push(t);
    }
    return out;
}

function sanitizeActionText(raw: unknown): string {
    if (typeof raw !== "string") return "";
    return raw.trim();
}

/**
 * 把 raw globalInput 转成 ParsedGlobalInput；过滤掉空 key。
 * 直接返回 ParsedGlobalInput，不构造 inline object，避免 defaultValue 显式 undefined
 * 与 ParsedGlobalInput.defaultValue 可选字段类型不兼容。
 */
function toParsedGlobalInput(raw: { key?: unknown; hasDefault?: unknown; defaultValue?: unknown }): ParsedGlobalInput | null {
    const key = sanitizeName(raw.key);
    if (!key) return null;
    const hasDefault = !!raw.hasDefault;
    const dv = sanitizeActionText(raw.defaultValue);
    const gi: ParsedGlobalInput = { key, hasDefault };
    if (hasDefault && dv) gi.defaultValue = dv;
    return gi;
}

function normalize(ex: ExtractedWorkflow): CachedWorkflow {
    const sorted = [...ex.nodes].sort((a, b) => (a.order ?? 0) - (b.order ?? 0));

    const nodes: ParsedNode[] = sorted
        .map((n) => ({
            order: 0,
            name: sanitizeName(n.name),
            intent: sanitizeActionText(n.intent),
            inputs: sanitizeNames(n.inputs),
            outputs: sanitizeNames(n.outputs),
            action: sanitizeActionText(n.action),
            sourceLines: { start: 0, end: 0 },
        }))
        .filter((n) => n.name.length > 0)
        .map((n, i) => ({ ...n, order: i + 1 }));

    const globalInputs: ParsedGlobalInput[] = [];
    for (const gi of ex.globalInputs ?? []) {
        const parsed = toParsedGlobalInput(gi);
        if (parsed) globalInputs.push(parsed);
    }

    const flowName = sanitizeName(ex.flowName) || "工作流";
    const goal = sanitizeActionText(ex.goal);

    return { flowName, goal, globalInputs, nodes, artifactSemantics: [] };
}

function collectArtifactNames(cached: CachedWorkflow): string[] {
    const set = new Set<string>();
    for (const gi of cached.globalInputs) set.add(gi.key);
    for (const n of cached.nodes) {
        for (const i of n.inputs) set.add(i);
        for (const o of n.outputs) set.add(o);
    }
    return [...set];
}

// ════════════════════════════════════════════════════════════════════
// 辅助
// ════════════════════════════════════════════════════════════════════

function formatArtifactFeedback(report: ArtifactReport): string[] {
    const lines: string[] = [];
    if (report.orphans.length > 0) {
        lines.push(
            `[DAG验证] 以下产物被消费但无任何步骤产出（孤儿）：${report.orphans
                .map((o) => `「${o.name}」被 [${o.consumedBy.join(", ")}] 消费`)
                .join("、")}。请检查：是否漏写了产出该产物的步骤？或该产物本应作为全局输入/配置项？`,
        );
    }
    if (report.dead.length > 0) {
        lines.push(
            `[DAG验证] 以下产物被产出但无任何步骤消费（死产物）：${report.dead
                .map((d) => `「${d.name}」由 [${d.producedBy}] 产出`)
                .join("、")}。请检查：是否漏写了消费该产物的步骤？或下游步骤引用它时用了不同的名称？`,
        );
    }
    return lines;
}