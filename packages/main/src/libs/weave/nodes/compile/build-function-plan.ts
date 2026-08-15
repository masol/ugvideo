/**
 * weaver · compile · LLM 主思考 + markdown 解析抽取 TS 伪代码
 *
 * v3：简化反馈回灌逻辑——只有结构反馈（纯规则），无语义 LLM 反馈。
 */

import { getSmartModel } from "$libs/model/balancer/get-smart-model.js";
import { generateText, type ModelMessage } from "ai";
import type { WeaveContext } from "../../context.js";
import type { FlowNode } from "../../types.js";
import type {
    ApiKind,
    ExternalFunction,
    FunctionPlan,
    InstructionDef,
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
                `## 上一轮输出的格式有问题，请修正后重新输出完整的 Execution Plan：`,
                ``,
                ...feedback.map((f, i) => `${i + 1}. ${f}`),
                ``,
                `请重新输出完整的 Execution Plan markdown（从 # Execution Plan for ... 开始）。`,
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
// Markdown → FunctionPlan + Code
// ══════════════════════════════════════════════════════════════════

function parsePlanFromMarkdown(
    text: string,
    input: BuildPlanInput,
): { plan: FunctionPlan; code: string } {
    const apiKind = parseApiKind(text);
    const code = parseCodeBlock(text);
    const instructions = parseInstructionsSection(text);
    const externalFunctions = parseExternalFunctionsSection(text);

    const plan: FunctionPlan = {
        sourceNodeId: input.node.id,
        sourceNodeName: input.node.name,
        apiKind,
        instructions,
        externalFunctions,
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

function parseInstructionsSection(text: string): InstructionDef[] {
    const defs: InstructionDef[] = [];
    const m = text.match(/##\s*Instructions\s*\n([\s\S]*?)(?=\n##|$)/i);
    if (!m) return defs;

    const lines = m[1].split("\n");
    let currentId: string | null = null;
    let currentContent: string[] = [];

    for (const line of lines) {
        const idMatch = line.match(/^-\s*id:\s*(.+)$/);
        if (idMatch) {
            if (currentId) {
                defs.push({ id: currentId, content: currentContent.join("\n").trim() });
            }
            currentId = idMatch[1].trim();
            currentContent = [];
            continue;
        }
        const contentMatch = line.match(/^\s+content:\s*(.+)$/);
        if (contentMatch && currentId) {
            currentContent.push(contentMatch[1].trim());
            continue;
        }
        if (currentId && line.trim()) {
            currentContent.push(line.trim());
        }
    }
    if (currentId) {
        defs.push({ id: currentId, content: currentContent.join("\n").trim() });
    }

    return defs;
}

function parseExternalFunctionsSection(text: string): ExternalFunction[] {
    const functions: ExternalFunction[] = [];
    const m = text.match(/##\s*External\s+Functions?\s*\n([\s\S]*?)(?=\n##|$)/i);
    if (!m) return functions;

    const lines = m[1].split("\n");
    for (const line of lines) {
        const lm = line.match(/^-\s*`([^`]+)`(?::\s*(.+))?$/);
        if (!lm) continue;
        functions.push({ name: lm[1], purpose: lm[2]?.trim() || "" });
    }
    return functions;
}