/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * weaver · parse · 提取入口（v6.1）
 *
 * 变更（v6.1）：
 * - 修复死产物判定：由 DAG 终端节点（outDegree=0）产出的 artifact 是最终
 *   交付物，不应被视为阻断性死产物——只记warning。
 *   只有非终端节点产出的、无下游消费的 artifact 才是真正的死产物（图边缺失）。
 * - 其余逻辑与 v6.0 一致（frozenNames / applyFrozenNames 等）。
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
    key: z.string().describe("全局输入项/ 配置项的名称，直接沿用原文中的叫法。"),
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

        // 关键：name 归一化到 frozen names
        if (options.frozenNames) {
            applyFrozenNames(extracted, options.frozenNames);
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

        //── 关键修复：区分"真正死产物"与"终产物"──
        //
        // 终端节点（DAG 中outDegree=0 的节点）产出的 artifact 就是
        // 工作流的最终交付物，天然无下游消费——不应视为死产物。
        // 只有非终端节点产出的、无任何消费者的 artifact 才是真正的死产物
        // （说明 DAG 边缺失，LLM 漏声明了输入）。
        const terminalNodeIds = new Set<string>();
        flow.g.forEachNode((id) => {
            if (flow.g.outDegree(id) === 0) terminalNodeIds.add(id);
        });

        const genuineDeadArtifacts = artifactReport.dead.filter(
            (d) => !terminalNodeIds.has(d.producedBy),
        );

        const terminalArtifacts = artifactReport.dead.filter(
            (d) => terminalNodeIds.has(d.producedBy),
        );

        if (terminalArtifacts.length > 0) {
            ctx.ctx.info?.(
                `[extract] doc ${docIndex + 1} round ${round + 1} 终产物（非阻断）：` +
                terminalArtifacts.map((d) => `「${d.name}」`).join("、"),
            );
        }

        if (
            stepFixable.length === 0 &&
            artifactReport.orphans.length === 0 &&
            genuineDeadArtifacts.length === 0 &&   // ← 仅阻断"真正死产物"
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

        // ── 只把真正死产物的反馈发给 LLM ──
        const bucketed = bucketFeedbacksByStep(stepFixable, actionIssues);
        const artifactFeedback = formatArtifactFeedback({
            ...artifactReport,
            dead: genuineDeadArtifacts,  // 终产物不灌回 LLM
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
        ]; ctx.ctx.notify(
            "extract",
            `doc ${docIndex + 1} 第 ${round + 1} 轮：${lastFeedback.length} 条反馈回灌语义整理`,
        );
    }

    throw new Error(
        `[extract] doc ${docIndex} 经${maxRounds} 轮reAct 仍未通过验证：\n${lastFeedback.join("\n")}`,
    );
}

//════════════════════════════════════════════════════════════════════
// 错误分类
// ════════════════════════════════════════════════════════════════════

function isStructuralError(e: ValidationError): boolean {
    return (
        e.kind === "cycle" ||
        e.kind === "unreachable" ||
        e.kind === "no-terminal" ||
        e.kind === "multiple-terminal"
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
// frozen names 归一化
// ════════════════════════════════════════════════════════════════════

function applyFrozenNames(
    extracted: ExtractedWorkflow,
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

    for (const node of extracted.nodes) {
        node.inputs = node.inputs.map(replace);
        node.outputs = node.outputs.map(replace);
    } for (const gi of extracted.globalInputs) {
        gi.key = replace(gi.key);
    }
}

// ════════════════════════════════════════════════════════════════════
// 归一化
// ════════════════════════════════════════════════════════════════════

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
            action: sanitizeActionText(n.action), sourceLines: { start: 0, end: 0 },
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
                .map((o) => `「${o.name}」被[${o.consumedBy.join(", ")}] 消费`)
                .join("、")}。请检查：是否漏写了产出该产物的步骤？或该产物本应作为全局输入/配置项？`,
        );
    }
    if (report.dead.length > 0) {
        lines.push(
            `[DAG验证] 以下产物被产出但无任何步骤消费（死产物）：${report.dead
                .map((d) => `「${d.name}」由步骤 [${d.producedBy}] 产出`)
                .join("、")}。` +
            `死产物意味着图中缺少消费该产物的依赖边。请检查：` +
            `(a) 是否有下游步骤在动作中使用了该产物但未将其列入inputs？` +
            `若是，请补充到该下游步骤的输入列表；` +
            `(b) 若该产物是工作流的中间产出，请确认下游步骤确实引用了它。` +
            `（注意：工作流最终交付物不算死产物，无需下游消费。）`,
        );
    }
    return lines;
}