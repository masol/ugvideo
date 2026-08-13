/**
 * weaver · parse · 提取入口
 *
 * 变更：
 * - 验证通过后运行专职子 LLM 抽取交付物语义作用（extractArtifactSemantics），
 *   回填到 artifact/config 的 intent，并随 CachedWorkflow 持久化（缓存重建复用）。
 * - 控制流与约束仍以自然语言保留在 action 中，不结构化提取。
 */

import { safefmt } from "$libs/model/llm/outline.js";
import type { ModelMessage } from "ai";
import { Output } from "ai";
import { z } from "zod";
import type { WeaveContext } from "../../context.js";
import { validateHumanFlow } from "../../graph/validate.js";
import type { HumanFlow } from "../../types.js";
import { checkActionCompleteness } from "./action-completeness.js";
import type { ArtifactRegistry } from "./build-flow.js";
import { applyArtifactSemantics, buildHumanFlowFromParsed } from "./build-flow.js";
import { extractArtifactSemantics } from "./extract-artifact-semantics.js";
import type { ArtifactSemantic, ParsedGlobalInput, ParsedNode } from "./parse-types.js";
import { renderStandardDoc } from "./render-standard.js";
import { semanticRefine } from "./semantic-refine.js";

// ════════════════════════════════════════════════════════════════════
// 类型定义
// ════════════════════════════════════════════════════════════════════

export interface ArtifactReport {
    orphans: { name: string; consumedBy: string[] }[];
    dead: { name: string; producedBy: string }[];
    total: number;
}

/** 结构化抽取 + 归一化后的工作流数据（可序列化，供缓存与确定性重建） */
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
// safefmt 抽取 schema —— 抽取质量完全由 describe 决定
// ════════════════════════════════════════════════════════════════════

const GlobalInputSchema = z.object({
    key: z
        .string()
        .describe(
            "全局输入项 / 配置项的名称，直接沿用原文中的叫法，不要改名、翻译或添加符号。",
        ),
    hasDefault: z
        .boolean()
        .describe(
            "该项是否为带固定内容的配置项。若原文提供了可整体复用的固定素材" +
            "（如结构化大纲模板、标题公式清单、待回答问题清单、检查清单、示例库等），则为 true；" +
            "若只是需从外部提供、无固定内容的初始材料，则为 false。",
        ),
    defaultValue: z
        .string()
        .describe(
            "当 hasDefault 为 true 时，填该配置项的【完整逐字内容】" +
            "（例如结构化大纲模板的全文、全部标题公式、全部待回答问题）——" +
            "必须原样保留，绝不概括、绝不省略、绝不删减；" +
            "hasDefault 为 false 时填空字符串。",
        ),
});

const ExtractedNodeSchema = z.object({
    order: z
        .number()
        .int()
        .describe("步骤序号，从 1 开始的连续整数，严格按执行先后顺序排列，不得跳号或重复。"),
    name: z
        .string()
        .describe(
            "步骤名称，简洁的动宾短语，例如'确定文章主题与目标读者'。同一名称在全流程内唯一。",
        ),
    intent: z.string().describe("本步骤的业务目的，用一句话说明为什么要执行这一步。"),
    inputs: z
        .array(z.string())
        .describe(
            "本步骤所需的输入产物 / 配置项名称列表。每个名称直接沿用原文叫法，" +
            "且必须与产出它的步骤 outputs 中的名称、或全局配置项名称逐字完全一致。" +
            "凡是本步骤动作里真正会用到的模板/清单/上游产物，都要在此声明；" +
            "凡是声明了却在动作里用不到的项，不要写。若无输入则填空数组。",
        ),
    outputs: z
        .array(z.string())
        .describe(
            "本步骤产出的产物名称列表。每个名称直接沿用原文叫法，供下游步骤在 inputs 中按逐字相同的名称引用。" +
            "若无输出则填空数组。",
        ),
    action: z
        .string()
        .describe(
            "本步骤的完整可执行动作描述，主谓宾齐全。必须【逐字】完整保留原文中该步骤的所有执行细节、判断标准、条件分支与循环控制。\n" +
            "信息零丢失要求：\n" +
            "  1. 所有控制流——'若 X 则回到/返回/跳到步骤 N'、'否则继续'、'重复直到…'、'转去某流程'——" +
            "必须原样保留在本动作文本里，用自然语言表达，【不要】拆成单独字段或章节；\n" +
            "  2. 所有质量约束/校验条件——'字数不少于…'、'读起来要自然'、'外行要能看懂'等——同样保留在动作文本里；\n" +
            "  3. 动作中引用的每一个产物 / 配置项名称，必须与本步骤 inputs/outputs 或全局配置项里的名称逐字一致，并用反引号包裹；\n" +
            "  4. 不得把原文的模板、公式清单、问题清单等具体内容在动作里丢弃或概括——" +
            "这类固定素材应作为全局配置项声明（见 globalInputs），并在本步骤 inputs 中按名引用。",
        ),
});

const WorkflowSchema = z.object({
    flowName: z
        .string()
        .describe("整个工作流的名称，取自文档的一级标题，或对全流程目标的简洁概括。"),
    goal: z.string().describe("整个工作流的总目标，一段话描述本工作流最终要达成什么。"),
    globalInputs: z
        .array(GlobalInputSchema)
        .describe(
            "工作流的全局输入项与配置项：\n" +
            "  (a) 不由任何步骤产出、需从外部提供的初始材料（hasDefault=false）；\n" +
            "  (b) 原文中出现的可复用固定素材（模板、公式清单、问题清单、检查清单、示例库等），" +
            "hasDefault=true 且 defaultValue 存完整逐字内容，并确保消费它的步骤在 inputs 中按同名引用。\n" +
            "若没有则填空数组。",
        ),
    nodes: z
        .array(ExtractedNodeSchema)
        .describe(
            "按执行顺序排列的所有步骤，不得遗漏原文中的任何步骤。" +
            "每个步骤都必须完整填写 name / intent / inputs / outputs / action 五项。",
        ),
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

    for (let round = 0; round < maxRounds; round++) {
        ctx.ctx.notify(
            "extract",
            `doc ${docIndex + 1} 第 ${round + 1}/${maxRounds} 轮：语义整理`,
        );

        // ── 阶段 ①：语义整理（内部含 3 轮 messages 自检 reAct）──
        const { doc: semanticDoc, messages } = await semanticRefine(
            ctx,
            doc,
            options.goal ?? null,
            options.constraints ?? null,
            options.preferences ?? null,
            lastFeedback,
            lastSemanticMessages,
        );
        lastSemanticMessages = messages;

        ctx.ctx.info?.(
            `[extract] doc ${docIndex + 1} round ${round + 1} 语义整理完成，长度 ${semanticDoc.length}`,
        );

        // ── 阶段 ②：safefmt 抽取结构化 JSON ──
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

        // ── 阶段 ③：归一化 → 构建 flow + DAG 验证 ──
        const cached = normalize(extracted);
        if (cached.nodes.length === 0) {
            lastFeedback = ["[结构化抽取] 未抽取到任何有效步骤，请确保文档中的每个步骤都清晰可辨。"];
            ctx.ctx.notify(
                "extract",
                `doc ${docIndex + 1} 第 ${round + 1} 轮：无有效步骤，回退语义整理`,
            );
            continue;
        }

        // ── 阶段 ④：动作完整性 + 输入自洽性校验 ──
        const actionIssues = checkActionCompleteness(cached.nodes, cached.globalInputs);
        if (actionIssues.length > 0) {
            lastFeedback = actionIssues;
            ctx.ctx.notify(
                "extract",
                `doc ${docIndex + 1} 第 ${round + 1} 轮：动作/输入自洽性校验失败（${actionIssues.length} 个问题），回退语义整理`,
            );
            continue;
        }

        const flow = buildHumanFlowFromParsed(
            cached.flowName,
            cached.goal,
            cached.globalInputs,
            cached.nodes,
            ctx,
        );

        const validationErrors = validateHumanFlow(flow, ctx.conceptManager);
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

        // 结构 + 闭环校验全过才放行
        if (validationErrors.length === 0 && artifactReport.orphans.length === 0) {
            // ── 阶段 ⑤：交付物语义作用抽取 + 回填 intent（专职子 LLM）──
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

        lastFeedback = [
            ...validationErrors.map((e) => `[DAG验证] ${e.message}`),
            ...formatArtifactFeedback(artifactReport),
        ];

        ctx.ctx.notify(
            "extract",
            `doc ${docIndex + 1} 第 ${round + 1} 轮：验证失败（${lastFeedback.length} 个问题），回退语义整理`,
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
// 归一化：清洗 + 连续编号 + 去空
// ════════════════════════════════════════════════════════════════════

function normalize(ex: ExtractedWorkflow): CachedWorkflow {
    const sorted = [...ex.nodes].sort((a, b) => (a.order ?? 0) - (b.order ?? 0));

    const nodes: ParsedNode[] = sorted
        .map((n) => ({
            order: 0,
            name: (n.name ?? "").trim(),
            intent: (n.intent ?? "").trim(),
            inputs: cleanNames(n.inputs),
            outputs: cleanNames(n.outputs),
            action: (n.action ?? "").trim(),
            sourceLines: { start: 0, end: 0 },
        }))
        .filter((n) => n.name.length > 0)
        .map((n, i) => ({ ...n, order: i + 1 }));

    const globalInputs: ParsedGlobalInput[] = (ex.globalInputs ?? [])
        .map((gi) => {
            const dv = (gi.defaultValue ?? "").trim();
            return {
                key: (gi.key ?? "").trim(),
                hasDefault: !!gi.hasDefault,
                defaultValue: gi.hasDefault && dv ? dv : undefined,
            };
        })
        .filter((gi) => gi.key.length > 0);

    const flowName = (ex.flowName ?? "").trim() || "工作流";
    const goal = (ex.goal ?? "").trim();

    return { flowName, goal, globalInputs, nodes, artifactSemantics: [] };
}

function cleanNames(arr: string[] | undefined): string[] {
    const seen = new Set<string>();
    const out: string[] = [];
    for (const raw of arr ?? []) {
        const t = (raw ?? "").trim();
        if (!t || seen.has(t)) continue;
        seen.add(t);
        out.push(t);
    }
    return out;
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