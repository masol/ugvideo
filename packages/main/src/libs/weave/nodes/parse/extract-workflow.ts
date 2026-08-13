/**
 * weaver · parse · 提取入口（v14）
 *
 * 核心改动（v14）：
 * - 废弃"要求 LLM 输出严格 markdown 格式"的 section-format 脆弱路径
 * - 改为：semanticRefine 产出自然语言 → safefmt 抽取结构化 JSON → 代码确定性构建 flow
 * - 标准格式文档由代码 renderStandardDoc 渲染（格式 100% 正确，不再依赖 LLM 保证格式）
 * - reAct 结构保留：
 *   · 内层：semanticRefine 自身 3 轮 messages 自检
 *   · 外层：safefmt 抽取失败 / DAG 校验失败 → 反馈回灌 semanticRefine 重整理
 * - 抽取质量完全由下方 zod schema 的 .describe() 决定，尤其 action 要求"完整保留全文"
 */

import { safefmt } from "$libs/model/llm/outline.js";
import type { ModelMessage } from "ai";
import { Output } from "ai";
import { z } from "zod";
import type { WeaveContext } from "../../context.js";
import { validateHumanFlow } from "../../graph/validate.js";
import type { HumanFlow } from "../../types.js";
import type { ArtifactRegistry } from "./build-flow.js";
import { buildHumanFlowFromParsed } from "./build-flow.js";
import { renderStandardDoc } from "./render-standard.js";
import { semanticRefine } from "./semantic-refine.js";
import type { ParsedGlobalInput, ParsedJumper, ParsedNode } from "./standard.js";

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

const JumperSchema = z.object({
    kind: z
        .enum(["internal", "external"])
        .describe(
            "跳转类型：internal 表示跳到本工作流内的另一个步骤；external 表示跳到另一个独立工作流。",
        ),
    condition: z
        .string()
        .describe(
            "触发此跳转的条件描述，例如'审核不通过'、'字数不足'。若为无条件跳转（总是执行）则填空字符串。",
        ),
    target: z
        .string()
        .describe(
            "跳转目标：kind=internal 时填目标步骤的名称（须与某步骤 name 完全一致）或'步骤N'形式；kind=external 时填目标工作流的名称。",
        ),
});

const GlobalInputSchema = z.object({
    key: z
        .string()
        .describe("全局输入项的名称，直接沿用原文中的叫法，不要改名、翻译或添加任何符号。"),
    hasDefault: z
        .boolean()
        .describe(
            "该输入项是否带默认值。原文若说明'默认为…'或属于可配置项则为 true，否则 false。",
        ),
    defaultValue: z
        .string()
        .describe("当 hasDefault 为 true 时填默认值文本；hasDefault 为 false 时填空字符串。"),
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
            "本步骤所需的输入产物名称列表。每个名称直接沿用原文叫法，且必须与产出它的步骤 outputs 中的名称逐字完全一致（跨步骤严格同名）。若无输入则填空数组。",
        ),
    outputs: z
        .array(z.string())
        .describe(
            "本步骤产出的产物名称列表。每个名称直接沿用原文叫法，供下游步骤在 inputs 中按逐字完全相同的名称引用。若无输出则填空数组。",
        ),
    action: z
        .string()
        .describe(
            "本步骤的完整可执行动作描述，主谓宾齐全。必须完整保留原文中该步骤的所有执行细节、判断标准与条件分支（如'若审核不通过则回到第3步修改'），不得省略、概括、改写或丢失任何信息。",
        ),
    jumpers: z
        .array(JumperSchema)
        .describe(
            "标准顺序流之外的额外跳转。仅当 action 中明确出现'跳回/返回到某步骤'或'转到其他工作流'这类非顺序跳转时才填写；普通顺序执行不要产生 jumper，填空数组。",
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
            "工作流的全局输入项：那些不由任何步骤产出、需从外部提供的材料或配置（例如首个步骤所需的初始素材）。若没有则填空数组。",
        ),
    nodes: z
        .array(ExtractedNodeSchema)
        .describe("按执行顺序排列的所有步骤，不得遗漏原文中的任何步骤。"),
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

        // ── 阶段 ②：safefmt 抽取结构化 JSON（代替脆弱的 markdown 格式化）──
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

        if (validationErrors.length === 0 && artifactReport.orphans.length === 0) {
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
            order: 0, // 占位，下面重排为连续序号
            name: (n.name ?? "").trim(),
            intent: (n.intent ?? "").trim(),
            inputs: cleanNames(n.inputs),
            outputs: cleanNames(n.outputs),
            action: (n.action ?? "").trim(),
            jumpers: (n.jumpers ?? [])
                .map(toParsedJumper)
                .filter((j) => j.target !== "" || j.condition !== null),
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

    return { flowName, goal, globalInputs, nodes };
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

function toParsedJumper(j: {
    kind: "internal" | "external";
    condition: string;
    target: string;
}): ParsedJumper {
    const condition = (j.condition ?? "").trim();
    return {
        kind: j.kind === "external" ? "external" : "internal",
        condition: condition ? condition : null,
        target: (j.target ?? "").trim(),
    };
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
                .join("、")}。请检查：是否漏写了产出该产物的步骤？或该产物本应作为全局输入？（若是全局输入，请在整理时明确标注它由外部提供）`,
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