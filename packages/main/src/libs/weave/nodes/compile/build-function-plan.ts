/**
 * weaver · compile · LLM 主思考 + markdown 解析抽取可执行 JavaScript
 *
 * v6：
 *   - 产物为 JavaScript（不再用 TS 伪代码），verify 阶段做 terser + vm.Script 校验；
 *   - 注入 API 清单（非 tool 调用），verify 阶段静态扫描调用合规性；
 *   - 解析代码块 regex 支持 ```js / ```javascript / ```typescript / 裸 ``` 兜底。
 */

import { getSmartModel } from "$libs/model/balancer/get-smart-model.js";
import { generateText, type ModelMessage } from "ai";
import type { WeaveContext } from "../../context.js";
import type { FlowNode } from "../../types.js";
import { buildApiCatalog, type ApiCatalog } from "./api-catalog.js";
import type { ApiKind, FunctionPlan, InstructionDef } from "./parse-types.js";
import COMPILE_INSTRUCTIONS from "./prompts/compile-instructions.txt?raw";

export interface BuildPlanInput {
    node: FlowNode;
    flowIntent: string;
    artifactContext: string;
    predecessorOutputs: string[];
    flowInputs: string[];
    availableTools: string[];
}

export interface BuildPlanResult {
    plan: FunctionPlan;
    code: string;
    messages: ModelMessage[];
    catalog: ApiCatalog;
}

export async function buildFunctionPlan(
    ctx: WeaveContext,
    input: BuildPlanInput,
    previousMessages?: ModelMessage[],
    feedback?: string[],
): Promise<BuildPlanResult> {
    const messages: ModelMessage[] = previousMessages ? [...previousMessages] : [];
    const catalog = buildApiCatalog(input.availableTools);

    if (messages.length === 0) {
        const initialPrompt = [
            `## 工作流总目标`,
            input.flowIntent,
            ``,
            `## 当前步骤`,
            `- 名称：${input.node.name}`,
            `- 目的：${input.node.intent}`,
            `- 声明输入（入参对象 key）：${input.node.inputs.map((i) => `\`${i}\``).join("、") || "（无）"}`,
            `- 声明输出（返回对象 key）：${input.node.outputs.map((o) => `\`${o}\``).join("、") || "（无）"}`,
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
            `请把该步骤的"动作描述"编译为可执行 JavaScript（Execution Plan）。`,
            `请严格按 system prompt 中的产物形态输出：`,
            `# Execution Plan ... + ## api_kind + ## Instructions + ## Pseudocode（\`\`\`js 代码块\`\`\`）。`,
        ].join("\n");
        messages.push({ role: "user", content: initialPrompt });
    }

    if (feedback && feedback.length > 0) {
        messages.push({
            role: "user",
            content: [
                `## 上一轮代码未通过校验，请逐条修正后重新输出完整 Execution Plan：`,
                ``,
                ...feedback.map((f, i) => `${i + 1}. ${f}`),
                ``,
                `要求：`,
                `- 重新输出完整的 Execution Plan（从 \`# Execution Plan for ...\` 开始，到 ## Pseudocode 代码块结束）；`,
                `- 代码块必须是可以直接由 terser minify + vm.Script 编译通过的 JavaScript；`,
                `- 只调用 system prompt 中声明的 llm.* 与 tool.*。`,
            ].join("\n"),
        });
    }

    const systemBlock = [
        COMPILE_INSTRUCTIONS,
        ``,
        `---`,
        ``,
        catalog.renderAsSystemBlock(),
    ].join("\n");

    const { text } = await generateText({
        model: getSmartModel(undefined, ctx.ctx),
        instructions: systemBlock,
        messages,
    });

    messages.push({ role: "assistant", content: text });

    const { plan, code } = parsePlanFromMarkdown(text, input);
    return { plan, code, messages, catalog };
}

// ══════════════════════════════════════════════════════════════
// Markdown → FunctionPlan + Code
// ══════════════════════════════════════════════════════════════

function parsePlanFromMarkdown(
    text: string,
    input: BuildPlanInput,
): { plan: FunctionPlan; code: string } {
    const apiKind = parseApiKind(text);
    const code = parseCodeBlock(text);
    const instructions = parseInstructionsSection(text);

    const plan: FunctionPlan = {
        sourceNodeId: input.node.id,
        sourceNodeName: input.node.name,
        apiKind,
        language: "js",
        instructions,
    };
    return { plan, code };
}

function parseApiKind(text: string): ApiKind {
    const m = text.match(/##\s*api_kind[^\n]*\n+[`'"\s]*([a-zA-Z]+)[`'"\s]*/i);
    return (m?.[1]?.toLowerCase() as ApiKind) ?? "code";
}

function parseCodeBlock(text: string): string {
    return (
        text.match(/```(?:js|javascript)\n([\s\S]*?)\n```/)?.[1] ??
        text.match(/```typescript\n([\s\S]*?)\n```/)?.[1] ??
        text.match(/```\n([\s\S]*?)\n```/)?.[1] ??
        ""
    );
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