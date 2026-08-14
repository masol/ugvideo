/**
 * weaver · compile · LLM 主思考 + markdown 解析抽取 TS 伪代码
 */

import { getSmartModel } from "$libs/model/balancer/get-smart-model.js";
import { generateText, type ModelMessage } from "ai";
import type { WeaveContext } from "../../context.js";
import type { FlowNode } from "../../types.js";
import type {
    ApiKind,
    Constraint,
    ExternalFunction,
    FunctionPlan,
} from "./parse-types.js";
import COMPILE_INSTRUCTIONS from "./prompts/compile-instructions.txt?raw";

export interface BuildPlanInput {
    node: FlowNode;
    flowIntent: string;
    artifactContext: string;
    predecessorOutputs: string[];
    flowInputs: string[];
}

export interface BuildPlanResult {
    plan: FunctionPlan;
    code: string;
    messages: ModelMessage[];
}

export async function buildFunctionPlan(
    ctx: WeaveContext,
    input: BuildPlanInput,
    previousMessages?: ModelMessage[],
    feedback?: string[],
): Promise<BuildPlanResult> {
    const messages: ModelMessage[] = previousMessages ? [...previousMessages] : [];

    if (messages.length === 0) {
        const initialPrompt = [
            `## 工作流总目标`,
            input.flowIntent,
            ``,
            `## 当前步骤`,
            `- 名称：${input.node.name}`,
            `- 目的：${input.node.intent}`,
            `- 声明输入：${input.node.inputs.map((i) => `\`${i}\``).join("、") || "（无）"}`,
            `- 声明输出：${input.node.outputs.map((o) => `\`${o}\``).join("、") || "（无）"}`,
            `- 动作描述：${input.node.actionAtom}`,
            ``,
            `## 可用产物上下文`,
            input.artifactContext,
            ``,
            `## 前置节点产出（可作为隐式输入）`,
            input.predecessorOutputs.map((n) => `- \`${n}\``).join("\n") || "（无）",
            ``,
            `## 全局输入`,
            input.flowInputs.map((n) => `- \`${n}\``).join("\n") || "（无）",
            ``,
            `请把该步骤的动作描述编译为 TypeScript 伪代码（Execution Plan）。`,
        ].join("\n");
        messages.push({ role: "user", content: initialPrompt });
    }

    if (feedback && feedback.length > 0) {
        messages.push({
            role: "user",
            content: [
                `## 上一轮编译结果在校验后发现了以下问题，必须修正：`,
                ``,
                ...feedback.map((f, i) => `${i + 1}. ${f}`),
                ``,
                `请基于上一轮的分析，针对上述问题修正后，重新输出完整的 Execution Plan markdown。`,
                `（中文变量名必须与动作文本逐字一致；不要引入原文未提及的概念；必须保留所有控制流与并行关系）`,
            ].join("\n"),
        });
    }

    const { text } = await generateText({
        model: getSmartModel(undefined, ctx.ctx),
        instructions: COMPILE_INSTRUCTIONS,
        messages,
    });

    messages.push({ role: "assistant", content: text });

    const { plan, code } = parsePlanFromMarkdown(text, input);
    return { plan, code, messages };
}

// ══════════════════════════════════════════════════════════════════
// Markdown → FunctionPlan + Code（纯字符串解析）
// ══════════════════════════════════════════════════════════════════

function parsePlanFromMarkdown(
    text: string,
    input: BuildPlanInput,
): { plan: FunctionPlan; code: string } {
    const apiKind = parseApiKind(text);
    const code = parseCodeBlock(text);
    const summary = parseSummary(text);
    const constraints = parseConstraintsSection(text);
    const externalFunctions = parseExternalFunctionsSection(text, code);

    const plan: FunctionPlan = {
        sourceNodeId: input.node.id,
        sourceNodeName: input.node.name,
        apiKind,
        constraints,
        externalFunctions,
        summary,
    };

    return { plan, code };
}

function parseApiKind(text: string): ApiKind {
    const m = text.match(/##\s*api_kind\s*\n(\w+)/i);
    return (m?.[1] as ApiKind) ?? "code";
}

function parseCodeBlock(text: string): string {
    const m = text.match(/```(?:typescript|ts)\n([\s\S]*?)\n```/);
    return m?.[1] ?? "";
}

function parseSummary(text: string): string | undefined {
    const m = text.match(/##\s*Summary\s*\n([\s\S]*?)(?=\n##|$)/i);
    return m?.[1]?.trim() || undefined;
}

function parseConstraintsSection(text: string): Constraint[] {
    const constraints: Constraint[] = [];
    const m = text.match(/##\s*Constraints\s*\n([\s\S]*?)(?=\n##|$)/i);
    if (!m) return constraints;

    const lines = m[1].split("\n");
    let id = 0;
    for (const line of lines) {
        const lm = line.match(/^-\s*(?:C\d+:?\s*)?(.+)$/);
        if (!lm) continue;
        id++;
        constraints.push({
            id: `C${id}`,
            description: lm[1].trim(),
        });
    }
    return constraints;
}

function parseExternalFunctionsSection(text: string, code: string): ExternalFunction[] {
    const functions: ExternalFunction[] = [];

    // 从 External Functions 段落提取
    const m = text.match(/##\s*External\s+Functions?\s*\n([\s\S]*?)(?=\n##|$)/i);
    if (m) {
        const lines = m[1].split("\n");
        for (const line of lines) {
            const lm = line.match(/^-\s*`([^`]+)`(?::\s*(.+))?$/);
            if (!lm) continue;
            const name = lm[1];
            const purpose = lm[2]?.trim() || "";
            if (!functions.find((f) => f.name === name)) {
                functions.push({ name, purpose, signature: "" });
            }
        }
    }

    // 从代码中的 @external 注释提取
    const matches = [...code.matchAll(/\/\/\s*@external:\s*(\S+)(?:\s+(.+))?/g)];
    for (const match of matches) {
        const name = match[1];
        const purpose = match[2]?.trim() || "";
        if (!functions.find((f) => f.name === name)) {
            functions.push({ name, purpose, signature: "" });
        }
    }

    return functions;
}