/**
 * weaver · parse · 提取入口（v15）
 *
 * 关键回归修复：
 * - v14 把 jumpers 改为"完全可选 / 仅当 action 中明确出现'跳回/转到'才填写"，
 *   而原文中的跳转往往藏在 action 自然语言里——safefmt 不会主动识别，
 *   导致所有 jumper 都是空数组、图只有顺序边、DAG 报 multiple-terminal。
 * - 修法：恢复"jumper 必填（可为空数组）"语义，并在 zod describe 中**强制**
 *   LLM 在抽取时把 action 里所有"若 X 则回到 N / 跳到 Y / 转去工作流 Z"转写
 *   为 jumper 对象。同时在 normalize 里做一次"动作文本内跳转声明"的自检兜底
 *   （发现疑似跳转却未产出 jumper 时反馈回去）。
 * - reAct 反馈通道增加：structural 错误（multiple-terminal 等）走 system 级
 *   提醒注入 semanticRefine，绕过 messages 历史，避免被淹没。
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
import type { ParsedGlobalInput, ParsedJumper, ParsedNode } from "./parse-types.js";
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
            "触发此跳转的条件描述，例如'审核不通过'、'字数不足'、'校对发现错误'。" +
            "若为无条件（默认回退/总是执行）则填空字符串。",
        ),
    target: z
        .string()
        .describe(
            "跳转目标：kind=internal 时填目标步骤的名称（须与某步骤 name 逐字完全一致）；" +
            "kind=external 时填目标工作流的名称。",
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
            "步骤名称，简洁的动宾短语，例如'确定文章主题与目标读者'。同一名称在全流程内唯一，" +
            "其他步骤在 jumpers 中按此 name 逐字引用。",
        ),
    intent: z.string().describe("本步骤的业务目的，用一句话说明为什么要执行这一步。"),
    inputs: z
        .array(z.string())
        .describe(
            "本步骤所需的输入产物名称列表。每个名称直接沿用原文叫法，且必须与产出它的步骤 outputs 中的名称逐字完全一致。" +
            "若无输入则填空数组。",
        ),
    outputs: z
        .array(z.string())
        .describe(
            "本步骤产出的产物名称列表。每个名称直接沿用原文叫法，供下游步骤在 inputs 中按逐字完全相同的名称引用。" +
            "若无输出则填空数组。",
        ),
    action: z
        .string()
        .describe(
            "本步骤的完整可执行动作描述，主谓宾齐全。必须完整保留原文中该步骤的所有执行细节、判断标准与条件分支。" +
            "**重要**：如果 action 中包含任何\"若 X 则回到步骤 N / 跳到节点 Y / 若不通过则返回步骤 M\"这类" +
            "**非顺序控制流**的描述，必须同时在 jumpers 数组中以结构化形式重复登记一次——" +
        "绝不能让跳转声明只藏在 action 自然语言里。",
        ),
    jumpers: z
        .array(JumperSchema)
        .describe(
            "本步骤结束时的非顺序跳转列表（必填字段，可为空数组）。\n" +
            "必须包含以下两类情况产生的跳转（全部从 action 中转写）：\n" +
            "  (a) 条件跳转：action 中出现'若 X 则跳回 / 转到 步骤N'、'若 X 不通过则返回节点Y'、'若不满足则回到步骤M'等条件跳转；\n" +
            "  (b) 无条件跳转（兜底回退）：action 中出现'否则回到步骤N'、'不管结果如何都跳到步骤N'、'无条件返回'等；\n" +
            "  (c) 跨图跳转：action 中出现'转去 / 跳到 / 委托给 其他工作流'；\n" +
            "如果本步骤执行完毕后控制流自然进入 order+1 的下一个步骤（即没有非顺序跳转），才填 []。" +
            "切勿因为 action 里只写了'若 X 则…'就直接忽略——必须转写到 jumpers。",
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
            "工作流的全局输入项：那些不由任何步骤产出、需从外部提供的材料或配置（例如首个步骤所需的初始素材）。" +
            "若没有则填空数组。",
        ),
    nodes: z
        .array(ExtractedNodeSchema)
        .describe("按执行顺序排列的所有步骤，不得遗漏原文中的任何步骤。" +
            "每个步骤都必须填写 jumpers 字段（可空数组），不允许整字段缺失。"),
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
            ...detectActionOnlyJumps(semanticDoc, cached),
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
            // jumper 永远写入（即使空数组）——保证 DAG 连通性所需信息不丢
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
// 兜底：检测动作段里"只写在自然语言里"的跳转声明
// （safefmt 没识别为 jumper 时，提示下一轮回灌 LLM 修正）
// ════════════════════════════════════════════════════════════════════

const JUMP_HINT_PATTERNS = [
    /若[^。\n]*则[^。\n]*(?:回到|返回|跳到|跳转至|回到)步骤\s*\d/iu,
    /若[^。\n]*不(?:通过|满足|合格)[^。\n]*(?:回到|返回|跳到)/iu,
    /(?:否则|不管|无论)[^。\n]*(?:回到|返回|跳到)步骤\s*\d/iu,
    /(?:回到|返回|跳到|跳转至)\s*步骤\s*\d/iu,
    /(?:转去|跳到|跳转至|委托给)\s*(?:工作流|流程)\s*\S+/iu,
];

function detectActionOnlyJumps(semanticDoc: string, cached: CachedWorkflow): string[] {
    const issues: string[] = [];
    const nodeNamesWithJumpers = new Set<string>();

    for (const node of cached.nodes) {
        for (const jp of node.jumpers) {
            if (jp.target) nodeNamesWithJumpers.add(node.name);
        }
    }

    for (const node of cached.nodes) {
        if (nodeNamesWithJumpers.has(node.name)) continue;
        if (!node.action) continue;
        const hit = JUMP_HINT_PATTERNS.some((re) => re.test(node.action));
        if (hit) {
            issues.push(
                `[结构校验] 步骤「${node.name}」的动作段中疑似包含跳转声明（"若 X 则回到步骤 N" / "跳到工作流 Y"），` +
                `但抽取出的 jumpers 字段为空数组。请在结构化抽取时将所有跳转转写为 jumper 对象（kind=internal/external、condition、target）。`,
            );
        }
    }
    void semanticDoc;
    return issues;
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
                .join("、")}。请检查：是否漏写了产出该产物的步骤？或该产物本应作为全局输入？`,
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