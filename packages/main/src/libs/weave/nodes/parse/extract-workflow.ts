/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * weaver · parse · 提取入口（v6.9）
 *
 * 变更（v6.9）：
 * - 【修复反馈回灌死循环】section 修补分支（repair.changed=true）此前只把 allGlobal
 *   回灌给下一轮 semanticRefine，而当阻断源全部是 step 级问题时 allGlobal 为空，
 *   导致下一轮 semanticRefine 收到空反馈、不知要改什么，LLM 自由重整理后同样问题
 *   复现 —— reAct 空转到耗尽（实测微信长文工作流 4 轮全空转失败）。
 *   现修复为：无论是否走 section 修补，都把 step 级反馈 + global 反馈一并回灌，
 *   确保 semanticRefine 始终带着"要改什么"的完整信息前进。
 *
 * 变更（v6.8）：可观测性增强（保留）。
 * 变更（v6.7）：死产物不阻断，降级为 build-flow 告警；保留 orphans 阻断。
 * 变更（v6.5）：semanticRefine 的 messages 在 reAct 轮次间正确透传。
 */

import { safefmt } from "$libs/model/llm/outline.js";
import type { ModelMessage } from "ai";
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
    let messages: ModelMessage[] | undefined = undefined;

    for (let round = 0; round < maxRounds; round++) {
        const roundTag = `doc ${docIndex + 1} round ${round + 1}`;
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
            messages,
            options.frozenNames ?? null,
        );
        const semanticDoc = refine.doc;
        messages = refine.messages;
        workingDoc = semanticDoc;

        ctx.ctx.info?.(
            `[extract] ${roundTag} 语义整理完成，长度 ${semanticDoc.length}`,
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
                `[extract] ${roundTag} structural错误（不可由语义整理修复）：` +
                structuralOnly.map((e) => `[${e.kind}] ${e.message}`).join("；"),
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

        // ── 可观测性：打印本轮所有阻断源原文 ──
        ctx.ctx.info?.(
            `[extract] ${roundTag} 阻断源统计：` +
            `stepFixable=${stepFixable.length} ` +
            `actionIssues=${actionIssues.length} ` +
            `orphans=${artifactReport.orphans.length} ` +
            `dead(仅告警不阻断)=${artifactReport.dead.length}`,
        );
        if (stepFixable.length > 0) {
            ctx.ctx.info?.(
                `[extract] ${roundTag} stepFixable 明细：\n` +
                stepFixable
                    .map((e, i) => `  ${i + 1}. [kind=${e.kind}] [nodeId=${e.nodeId ?? "—"}] ${e.message}`)
                    .join("\n"),
            );
        }
        if (actionIssues.length > 0) {
            ctx.ctx.info?.(
                `[extract] ${roundTag} actionIssues 明细：\n` +
                actionIssues.map((m, i) => `  ${i + 1}. ${m}`).join("\n"),
            );
        }
        if (artifactReport.orphans.length > 0) {
            ctx.ctx.info?.(
                `[extract] ${roundTag} orphans 明细：\n` +
                artifactReport.orphans
                    .map((o, i) => `  ${i + 1}. 「${o.name}」被 [${o.consumedBy.join(", ")}] 消费但无人产出`)
                    .join("\n"),
            );
        }

        if (warnings.length > 0) {
            ctx.ctx.info?.(
                `[extract] ${roundTag} 警告：${warnings.map((w) => w.message).join("；")}`,
            );
        }

        // ══════════════════════════════════════════════════════════════
        // 通过条件：仅 stepFixable / orphans / actionIssues 三类阻断，死产物不阻断。
        // ══════════════════════════════════════════════════════════════
        if (
            stepFixable.length === 0 &&
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

        // ── 组织反馈 ──
        const bucketed = bucketFeedbacksByStep(stepFixable, actionIssues);
        const artifactFeedback = formatArtifactFeedback(artifactReport);
        const allGlobal = [...bucketed.global, ...artifactFeedback];

        // 完整反馈 = 所有 step 级反馈 + 所有 global 反馈。
        // 无论是否走 section 修补，都用它回灌 semanticRefine —— 这是本版核心修复：
        // 此前 section 修补分支只回灌 allGlobal，当阻断全是 step 级时为空，导致空转。
        const fullFeedback = [
            ...bucketed.stepTargets.flatMap((t) => t.feedbacks),
            ...allGlobal,
        ];

        // ── 可观测性 ──
        ctx.ctx.info?.(
            `[extract] ${roundTag} bucket 结果：stepTargets=${bucketed.stepTargets.length} ` +
            `global=${allGlobal.length} fullFeedback=${fullFeedback.length}`,
        );
        for (const t of bucketed.stepTargets) {
            ctx.ctx.info?.(
                `[extract] ${roundTag} stepTarget「${t.stepName}」的反馈：\n` +
                t.feedbacks.map((f, i) => `    ${i + 1}. ${f}`).join("\n"),
            );
        }
        if (allGlobal.length > 0) {
            ctx.ctx.info?.(
                `[extract] ${roundTag} global 反馈：\n` +
                allGlobal.map((f, i) => `    ${i + 1}. ${f}`).join("\n"),
            );
        }

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
            // 修复：section 修补后仍回灌完整反馈（含 step 级），避免下一轮空转。
            lastFeedback = fullFeedback;
            ctx.ctx.info?.(
                `[extract] ${roundTag} section 已修补，回灌完整反馈 ${fullFeedback.length} 条`,
            );
            continue;
        }

        lastFeedback = fullFeedback;
        ctx.ctx.info?.(
            `[extract] ${roundTag} section 未产生变更，回灌 lastFeedback 全文：\n` +
            lastFeedback.map((f, i) => `  ${i + 1}. ${f}`).join("\n"),
        );
        ctx.ctx.notify(
            "extract",
            `doc ${docIndex + 1} 第 ${round + 1} 轮：${lastFeedback.length} 条反馈回灌语义整理`,
        );
    }

    throw new Error(
        `[extract] doc ${docIndex} 经${maxRounds} 轮reAct 仍未通过验证。最后一轮反馈：\n` +
        (lastFeedback.length > 0
            ? lastFeedback.map((f, i) => `${i + 1}. ${f}`).join("\n")
            : "（lastFeedback 为空，请检查上方各轮 stepFixable/actionIssues 明细日志）"),
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
// 反馈格式化（仅 orphans，死产物不进反馈）
// ══════════════════════════════════════════════════════════════════

function formatArtifactFeedback(report: ArtifactReport): string[] {
    const lines: string[] = [];

    if (report.orphans.length > 0) {
        lines.push(
            `[DAG验证] 以下产物被消费但无任何步骤产出（孤儿）：${report.orphans
                .map((o) => `「${o.name}」被[${o.consumedBy.join(", ")}] 消费`)
                .join("、")}。请检查：是否漏写了产出该产物的步骤？或该产物本应作为全局输入/配置项？` +
            `另外请特别检查：是否因为同一产物在上游步骤产出时用了不同的名字（拼写/用词不一致），` +
            `导致下游引用的名字找不到对应产出——若是，请统一为完全一致的名称。`,
        );
    }

    return lines;
}