/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * weaver · preprocess-artifacts · LLM 补全（带 history 回灌的多轮对话）
 *
 * 关键改进：
 *   - messages 在多轮间累积传递（model message 历史回灌）
 *   - 每轮的错误反馈作为 user message 追加
 *   - 最终产出 markdown 行，再 safefmt 提取 *
 * 设计原则：错误不丢，LLM 看到完整对话上下文。
 */

import { getSmartModel } from "$libs/model/balancer/get-smart-model.js";
import { safefmt } from "$libs/model/llm/outline.js";
import { generateText, Output, type ModelMessage } from "ai";
import { z } from "zod";
import type { WeaveContext } from "../../context.js";
import type { ArtifactRelation, HumanFlow, HumanNode } from "../../types.js";

const REFINE_INSTRUCTIONS = `你是工作流产物语义关系分析专家。

任务：对工作流中每个 artifact / config，判断它在全局中的语义层级关系。

关系定义：
- partOf：当前 artifact 被哪些 artifact 包含（语义包含，非消费）。
- composedOf：当前 artifact 由哪些 artifact 拼装而成。
- arrayOf：若 shape='array'，元素类型对应的 artifact 名；否则填 null。
- refinedFrom：由哪些 artifact 提炼而来（"摘要来自原文"——信息减法）。
- derivedFrom：由哪些 artifact 推导而来（"结论由数据推出"——信息推理）。

工作流文档全文会一并提供，包含每个步骤的输入/输出/动作。

输出格式：每个产物占一行，用 "|" 分隔 6 个字段（无值则空）：
\`名称 | partOf | composedOf | arrayOf | refinedFrom | derivedFrom\`

严格要求：
1. 只输出清单中出现的产物名称，不得新增；
2. 没有充分证据的字段就留空（不要捏造）；
3. 不要复述 DAG 已表达的"被消费/被产出"关系；
4. 不要输出任何"以下是分析结果"之类的元信息。`;

export interface RefineContext {
    messages: ModelMessage[];
}

/**
 * 多轮 LLM 补全入口。messages 在多轮间累积。
 */
export async function refineRelationsByLLM(
    ctx: WeaveContext,
    flow: HumanFlow,
    artifactNames: string[],
    staticHints: {
        refinedFrom: Record<string, string[]>;
        arrayOf: Record<string, string | null>;
    },
    previousMessages?: ModelMessage[],
    feedback?: string[],
): Promise<{ relations: Record<string, ArtifactRelation>; messages: ModelMessage[] }> {
    if (artifactNames.length === 0) {
        return { relations: {}, messages: previousMessages ?? [] };
    }

    const messages: ModelMessage[] = previousMessages
        ? [...previousMessages]
        : [];

    const flowDoc = buildFlowDoc(ctx, flow);
    const nameList = artifactNames.map((n, i) => `${i + 1}. ${n}`).join("\n");
    const hintsBlock = buildHintsBlock(staticHints);

    if (messages.length === 0) {
        // 首轮：构造初始 prompt
        messages.push({
            role: "user",
            content:
                `## 工作流总目标\n${flow.intent}\n\n` +
                `## 工作流步骤详情\n${flowDoc}\n\n` +
                `${hintsBlock}` +
                `## 产物清单\n${nameList}\n\n` +
                `请对清单中的每个产物，各输出一行"名称 | partOf | composedOf | arrayOf | refinedFrom | derivedFrom"。无值则空字段。`,
        });
    }

    //追加反馈（如果有）
    if (feedback && feedback.length > 0) {
        messages.push({
            role: "user",
            content:
                `## 上一轮的输出在校验后发现了以下问题，必须修正：\n\n` +
                feedback.map((f, i) => `${i + 1}. ${f}`).join("\n") +
                `\n\n请基于上一轮的分析，针对上述问题修正后，重新输出完整的关系表。` +
                `（注意：产物名必须与清单逐字一致，不要引入清单外的新名字，不要捏造证据）`,
        });
    }

    const { text } = await generateText({
        model: getSmartModel(undefined, ctx.ctx),
        instructions: REFINE_INSTRUCTIONS,
        messages,
    });

    // 把 LLM 输出追加到 history
    messages.push({ role: "assistant", content: text });

    const relations = await extractRelations(ctx, text);
    return { relations, messages };
}

function buildFlowDoc(ctx: WeaveContext, flow: HumanFlow): string {
    const nodes = flow.g.nodes()
        .map((id) => ctx.conceptManager.nodes.get(id))
        .filter((n): n is HumanNode => n !== null);

    return nodes
        .map((n) =>
            `## ${n.name}\n` +
            `- 目的: ${n.intent}\n` +
            `- 输入: ${n.inputs.map((i) => `\`${i}\``).join("、") || "（无）"}\n` +
            `- 输出: ${n.outputs.map((o) => `\`${o}\``).join("、") || "（无）"}\n` +
            `- 动作: ${n.actionAtom}`,
        )
        .join("\n\n");
}

function buildHintsBlock(hints: {
    refinedFrom: Record<string, string[]>;
    arrayOf: Record<string, string | null>;
}): string {
    const lines: string[] = [];
    for (const [name, parents] of Object.entries(hints.refinedFrom)) {
        if (parents.length > 0) {
            lines.push(`- \`${name}\` 由 [${parents.join(", ")}] 提炼（静态推导，仅供参考）`);
        }
    }
    for (const [name, elem] of Object.entries(hints.arrayOf)) {
        if (elem) {
            lines.push(`- \`${name}\` 是数组，元素类型推断为 \`${elem}\`（静态推导）`);
        }
    }
    return lines.length > 0 ? `## 静态推导线索（仅供参考，可调整）\n${lines.join("\n")}\n\n`
        : "";
}

async function extractRelations(
    ctx: WeaveContext,
    text: string,
): Promise<Record<string, ArtifactRelation>> {
    const schema = z.object({
        artifacts: z.array(
            z.object({
                name: z.string().describe("产物名称，与清单逐字一致。"),
                partOf: z.array(z.string()).describe("被哪些产物包含；无则空数组。"),
                composedOf: z.array(z.string()).describe("由哪些产物拼装；无则空数组。"),
                arrayOf: z.string().nullable().describe("数组元素类型；非数组填 null。"),
                refinedFrom: z.array(z.string()).describe("由哪些产物提炼而来；无则空数组。"),
                derivedFrom: z.array(z.string()).describe("由哪些产物推导而来；无则空数组。"),
            }),
        ).describe("清单中每个产物的语义层级关系，逐一对应。"),
    });

    const result = await safefmt(text, Output.object({ schema }), ctx.ctx);
    if (!result.success || !result.value) return {};

    const out: Record<string, ArtifactRelation> = {};
    for (const r of (result.value.output as { artifacts: any[] }).artifacts) {
        const rel: ArtifactRelation = {};
        if (Array.isArray(r.partOf) && r.partOf.length > 0) rel.partOf = r.partOf;
        if (Array.isArray(r.composedOf) && r.composedOf.length > 0) rel.composedOf = r.composedOf;
        if (r.arrayOf != null) rel.arrayOf = r.arrayOf;
        if (Array.isArray(r.refinedFrom) && r.refinedFrom.length > 0) rel.refinedFrom = r.refinedFrom;
        if (Array.isArray(r.derivedFrom) && r.derivedFrom.length > 0) rel.derivedFrom = r.derivedFrom;
        out[r.name] = rel;
    }
    return out;
}