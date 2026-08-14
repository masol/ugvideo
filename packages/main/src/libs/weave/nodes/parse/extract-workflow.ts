/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * weaver · parse · 提取入口（v6.4）
 *
 * 变更（v6.4）：
 * - 终产物判定改为基于步骤 order（而非 DAG 拓扑结构）
 * - 终产物 = 由 order 最大的步骤产出的 artifact
 * - 这些 artifact 不视为"死产物"，无需下游消费
 */

import { safefmt } from "$libs/model/llm/outline.js";
import { Output } from "ai";
import { z } from "zod";
import type { WeaveContext } from "../../context.js";
import { blockingErrors, validateHumanFlow, type ValidationError } from "../../graph/validate.js";
import type { HumanFlow } from "../../types.js";
import { checkActionCompleteness } from "./action-completeness.js";
import type { ArtifactRegistry } from "./build-flow.js";
import { applyArtifactSemantics, buildHumanFlowFromParsed } from "./build-flow.js";
import { extractArtifactSemantics } from "./extract-artifact-semantics.js";
import type { ArtifactSemantic, FrozenNamesConstraint, ParsedGlobalInput, ParsedNode } from "./parse-types.js";
import { renderStandardDoc } from "./render-standard.js";
import { bucketFeedbacksByStep, repairSectionsByLLM } from "./section-repair.js";
import { semanticRefine } from "./semantic-refine.js";

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
    frozenNames?: FrozenNamesConstraint | null;
}

const GlobalInputSchema = z.object({
    key: z.string().describe("全局输入项/配置项的名称，直接沿用原文中的叫法。"),
    hasDefault: z.boolean().describe("是否为带固定内容的配置项。"),
    defaultValue: z.string().describe("配置项的【完整逐字内容】。hasDefault=false 时填空字符串。"),
});

const ExtractedNodeSchema = z.object({
    order: z.number().int().describe("步骤序号，从 1 开始的连续整数，不得跳号或重复。"),
    name: z.string().describe("步骤名称，简洁的动宾短语，全流程内唯一。"),
    intent: z.string().describe("本步骤的业务目的。"),
    inputs: z.array(z.string()).describe("输入产物/配置项名称列表，逐字一致。"),
    outputs: z.array(z.string()).describe("产出产物名称列表，逐字一致。"),
    action: z
        .string()
        .describe(
            "完整可执行动作描述，主谓宾齐全，保留所有控制流与质量约束。" +
            "动作中引用的产物/配置项名称必须与本步骤 inputs/outputs 或全局配置项里的名称逐字一致，并用反引号包裹。",
        ),
});

const WorkflowSchema = z.object({
    flowName: z.string().describe("工作流名称。"),
    goal: z.string().describe("工作流总目标。"),
    globalInputs: z.array(GlobalInputSchema).describe("全局输入项与配置项。"),
    nodes: z.array(ExtractedNodeSchema).describe("按执行顺序排列的所有步骤。"),
});

type ExtractedWorkflow = z.infer<typeof WorkflowSchema>;

export async function extractWorkflow(
    ctx: WeaveContext,
    doc: string,
    docIndex: number,
    options: ExtractOptions = {},
): Promise<ExtractResult> {
    ctx.ctx.notify("extract", `doc ${docIndex + 1}：开始语义整理`);

    const maxRounds = ctx.storage.config.getMaxReactRounds();
    let lastFeedback: string[] = [];
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
            undefined,
            options.frozenNames ?? null,
        );
        const semanticDoc = refine.doc;
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
                `doc ${docIndex + 1}第 ${round + 1} 轮：结构化抽取失败，回退语义整理`,
            );
            continue;
        }

        const cached = normalize(extracted);
        if (cached.nodes.length === 0) {
            lastFeedback = ["[结构化抽取] 未抽取到任何有效步骤，请确保文档中的每个步骤都清晰可辨。"];
            ctx.ctx.notify(
                "extract",
                `doc ${docIndex + 1}第 ${round + 1} 轮：无有效步骤，回退语义整理`,
            );
            continue;
        }

        if (options.frozenNames) {
            applyFrozenNamesToNormalized(cached, options.frozenNames);
        }

        const actionIssues = checkActionCompleteness(cached.nodes, cached.globalInputs);
        const flow = buildHumanFlowFromParsed(
            cached.flowName,
            cached.goal,
            cached.globalInputs,
            cached.nodes,
            ctx,
        );

        const validationAll = validateHumanFlow(
            flow,
            ctx.conceptManager,
            ctx.storage.config.getMaxPathsPerNode(),
        );
        const validationErrors = blockingErrors(validationAll);
        const warnings = validationAll.filter((e) => e.severity === "warning");

        const stepFixable: ValidationError[] = [];
        const structuralOnly: ValidationError[] = [];
        for (const e of validationErrors) {
            if (isStructuralError(e)) structuralOnly.push(e);
            else stepFixable.push(e);
        }
        if (structuralOnly.length > 0) {
            ctx.ctx.info?.(
                `[extract] doc ${docIndex + 1} round ${round + 1} structural错误（不可由语义整理修复）：` +
                structuralOnly.map((e) => e.message).join("；"),
            );
        }

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

        // ══════════════════════════════════════════════════════════════
        // 通用规则：终产物判定
        //
        // 终产物 = 由 order 最大的步骤产出的 artifact
        // 这些 artifact 是工作流的最终交付物，天然无需下游消费
        // 判定依据是"步骤顺序"，而非"DAG 拓扑"——这样拓扑补全不会干扰判定
        // �═════════════════════════════════════════════════════════════
        const terminalArtifactNames = new Set<string>();
        const maxOrder = cached.nodes.reduce((m, n) => Math.max(m, n.order), 0);
        const terminalNodes = cached.nodes.filter((n) => n.order === maxOrder);
        for (const tn of terminalNodes) {
            for (const outId of tn.outputs) terminalArtifactNames.add(outId);
        }

        const genuineDeadArtifacts = artifactReport.dead.filter(
            (d) => !terminalArtifactNames.has(d.name),
        );

        if (
            stepFixable.length === 0 &&
            artifactReport.orphans.length === 0 &&
            genuineDeadArtifacts.length === 0 &&
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

        // ── 反馈 ──
        const bucketed = bucketFeedbacksByStep(stepFixable, actionIssues);
        const artifactFeedback = formatArtifactFeedback({
            ...artifactReport,
            dead: genuineDeadArtifacts,
            nodes: cached.nodes,
        });
        const allGlobal = [...bucketed.global, ...artifactFeedback];

        const repair = await repairSectionsByLLM(
            ctx,
            { doc: semanticDoc, feedbacks: [] },
            bucketed.stepTargets,
        );

        if (repair.changed) {
            ctx.ctx.notify(
                "extract",
                `doc ${docIndex + 1} 第 ${round + 1} 轮：section修补${bucketed.stepTargets.length} 个步骤，重新抽取`,
            );
            workingDoc = repair.doc;
            lastFeedback = allGlobal;
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
        `[extract] doc ${docIndex} 经${maxRounds} 轮reAct 仍未通过验证：\n${lastFeedback.join("\n")}`,
    );
}

// ══════════════════════════════════════════════════════════════════
// 错误分类
// ══════════════════════════════════════════════════════════════════

function isStructuralError(e: ValidationError): boolean {
    return (
        e.kind === "cycle" ||
        e.kind === "unreachable" ||
        e.kind === "no-terminal" ||
        e.kind === "multiple-terminal"
    );
}

// ══════════════════════════════════════════════════════════════════
// safefmt 抽取
// ══════════════════════════════════════════════════════════════════

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

// ══════════════════════════════════════════════════════════════════
// frozen names 归一化
// ══════════════════════════════════════════════════════════════════

function applyFrozenNamesToNormalized(
    cached: CachedWorkflow,
    frozen: FrozenNamesConstraint,
): void {
    const Fuse = (globalThis as any).Fuse;
    if (typeof Fuse !== "function") return;

    const frozenNames = frozen.names;
    const frozenFuse = new Fuse(frozenNames, {
        threshold: 0.4,
        includeScore: true,
        ignoreLocation: true,
    });

    const replace = (s: string): string => {
        if (frozenNames.includes(s)) return s;
        const hits = frozenFuse.search(s);
        if (hits.length > 0 && hits[0].score !== undefined && hits[0].score <= 0.4) {
            return hits[0].item;
        }
        return s;
    };

    for (const node of cached.nodes) {
        node.inputs = node.inputs.map(replace);
        node.outputs = node.outputs.map(replace);
    }
    for (const gi of cached.globalInputs) {
        gi.key = replace(gi.key);
    }
}

// ══════════════════════════════════════════════════════════════════
// 归一化
// ══════════════════════════════════════════════════════════════════

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

// ══════════════════════════════════════════════════════════════════
// 反馈格式化
// ══════════════════════════════════════════════════════════════════

function formatArtifactFeedback(
    report: ArtifactReport & { nodes?: ParsedNode[] },
): string[] {
    const lines: string[] = [];

    if (report.orphans.length > 0) {
        lines.push(
            `[DAG验证] 以下产物被消费但无任何步骤产出（孤儿）：${report.orphans
                .map((o) => `「${o.name}」被[${o.consumedBy.join(", ")}] 消费`)
                .join("、")}。请检查：是否漏写了产出该产物的步骤？或该产物本应作为全局输入/配置项？`,
        );
    }

    if (report.dead.length > 0) {
        const nodes = report.nodes ?? [];
        const suggestions = report.dead.map((d) => {
            const producer = nodes.find((n) => n.name === d.producedBy);
            const producerOrder = producer?.order ?? 0;
            const downstreamCandidates = nodes
                .filter((n) => n.order > producerOrder)
                .map((n) => n.name)
                .slice(0, 3);

            return (
                `「${d.name}」由步骤 [${d.producedBy}] 产出但无任何下游步骤在 inputs 中引用。` +
                `建议：在后续步骤（${downstreamCandidates.join("、") || "无合适候选"}）的「输入」中显式添加 \`${d.name}\`，` +
                `并在「动作」段描述如何使用。如果该 artifact 确实不应被任何下游消费（如最终交付物），` +
                `请确认它出现在工作流输出登记中；如果是临时草稿可丢弃，请从产出步骤的 outputs 中移除该 artifact 名。`
            );
        });

        lines.push(
            `[DAG验证] 以下产物被产出但无任何步骤消费（死产物）：\n${suggestions
                .map((s, i) => `${i + 1}. ${s}`)
                .join("\n")}\n` +
            `死产物意味着图中缺少消费该产物的依赖边。请逐条按上述建议修正：\n` +
            `(a) 在下游合适步骤的「输入」中显式列出该 artifact；\n` +
            `(b) 若该产物是工作流的最终交付物，请在工作流输出中登记；\n` +
            `(c) 若该产物确无用途，从产出步骤的 outputs 中移除。`,
        );
    }

    return lines;
}