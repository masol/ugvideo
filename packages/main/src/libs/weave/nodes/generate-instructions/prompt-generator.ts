/**
 * weaver · generate-instructions · 单个 instruction 生成器（reAct 模式）
 *
 * v5：
 * - verify 拆为两层：代码检查（必含关键词）+ LLM 语义评审
 * - 结构检查放宽："目标/任务"改为"目标/任务/职责/核心动作"任一
 */

import { getSmartModel } from "$libs/model/balancer/get-smart-model.js";
import { generateText, type ModelMessage } from "ai";
import type { WeaveContext } from "../../context.js";
import type { InstructionGenContext } from "./index.js";
import META_GENERIC_INSTRUCTIONS from "./prompts/meta-generic-instructions.txt?raw";
import META_REVIEWER_INSTRUCTIONS from "./prompts/meta-reviewer-instructions.txt?raw";
import META_WRITER_INSTRUCTIONS from "./prompts/meta-writer-instructions.txt?raw";

const MAX_ROUNDS = 3;

export async function generateInstruction(
    ctx: WeaveContext,
    ictx: InstructionGenContext,
): Promise<string> {
    const category = classifyInstruction(ictx.id);
    const metaInstructions = selectMetaInstructions(category);

    const messages: ModelMessage[] = [
        { role: "user", content: buildInitialPrompt(ictx, category) },
    ];

    for (let round = 0; round < MAX_ROUNDS; round++) {
        const { text } = await generateText({
            model: getSmartModel(undefined, ctx.ctx),
            instructions: metaInstructions,
            messages,
        });

        messages.push({ role: "assistant", content: text });

        const codeCheck = structuralCheck(text, category);
        if (!codeCheck.ok) {
            if (round < MAX_ROUNDS - 1) {
                messages.push({ role: "user", content: codeCheck.feedback });
                ctx.ctx.info(
                    `[generateInstruction] 「${ictx.id}」第 ${round + 1} 轮结构检查未通过：${codeCheck.feedback.slice(0, 80)}`,
                );
            }
            continue;
        }

        const semanticCheck = await semanticCheckWithLLM(ctx, ictx, text, category);
        if (semanticCheck.ok) {
            return text.trim();
        }

        if (round < MAX_ROUNDS - 1) {
            messages.push({ role: "user", content: semanticCheck.feedback });
            ctx.ctx.info(
                `[generateInstruction] 「${ictx.id}」第 ${round + 1} 轮语义评审未通过：${semanticCheck.feedback.slice(0, 80)}`,
            );
        }
    }

    const lastAssistant = messages.filter((m) => m.role === "assistant").pop();
    return lastAssistant ? (lastAssistant.content as string).trim() : "";
}

type InstructionCategory =
    | { kind: "writer" }
    | { kind: "reviewer"; dimension: string }
    | { kind: "extractor" }
    | { kind: "generic" };

function classifyInstruction(id: string): InstructionCategory {
    if (id.includes("_reviewer")) {
        const m = id.match(/_([a-z_]+)_reviewer$/);
        const dimension = m ? m[1] : "general";
        return { kind: "reviewer", dimension };
    }
    if (id.includes("_writer")) return { kind: "writer" };
    if (id.includes("_extractor")) return { kind: "extractor" };
    return { kind: "generic" };
}

function selectMetaInstructions(category: InstructionCategory): string {
    switch (category.kind) {
        case "writer":
            return META_WRITER_INSTRUCTIONS;
        case "reviewer":
            return META_REVIEWER_INSTRUCTIONS;
        default:
            return META_GENERIC_INSTRUCTIONS;
    }
}

interface CheckResult {
    ok: boolean;
    feedback: string;
}

function structuralCheck(text: string, category: InstructionCategory): CheckResult {
    const trimmed = text.trim();
    const issues: string[] = [];

    const hasRole = /角色|身份|你是/i.test(trimmed);
    const hasGoal = /目标|任务|职责|核心动作/i.test(trimmed);
    const hasOutput = /输出/i.test(trimmed);

    if (!hasRole) issues.push("缺少「角色/身份」相关描述");
    if (!hasGoal) issues.push("缺少「目标/任务/职责」相关描述");
    if (!hasOutput) issues.push("缺少「输出」相关描述");

    if (category.kind === "writer") {
        const hasFeedbackGuidance =
            /反馈|修正|上一轮|上轮|根据.*修订/i.test(trimmed);
        if (!hasFeedbackGuidance) {
            issues.push('writer 类缺少"多轮修正指导"相关描述');
        }
    }

    if (category.kind === "reviewer") {
        if (!trimmed.includes("__PASS__")) {
            issues.push('reviewer 类必须包含 "__PASS__" 输出规则');
        }
    }

    if (/^(以下是|这是|系统提示词如下|提示词内容：)/i.test(trimmed)) {
        issues.push("包含元信息前缀，请直接输出提示词");
    }
    if (/^```/m.test(trimmed)) {
        issues.push("被代码块包裹，请去除");
    }

    if (issues.length > 0) {
        return {
            ok: false,
            feedback: `结构检查未通过：\n${issues.map((s, i) => `${i + 1}. ${s}`).join("\n")}\n\n请修正后重新输出完整提示词。`,
        };
    }
    return { ok: true, feedback: "" };
}

async function semanticCheckWithLLM(
    ctx: WeaveContext,
    ictx: InstructionGenContext,
    content: string,
    category: InstructionCategory,
): Promise<CheckResult> {
    const semanticsBlock: string[] = [];
    if (ictx.flowIntent) {
        semanticsBlock.push(`工作流总目标：${ictx.flowIntent.slice(0, 200)}`);
    }
    if (ictx.outputSemantics.length > 0) {
        semanticsBlock.push(
            `输出产物：${ictx.outputSemantics.map((s) => `\`${s.name}\`(${s.role || "无语义"})`).join("、")}`,
        );
    }
    if (ictx.existingHint && ictx.existingHint.length > 100) {
        semanticsBlock.push(`compile 阶段已有约束：\n${ictx.existingHint.slice(0, 300)}`);
    }

    if (semanticsBlock.length === 0) {
        return { ok: true, feedback: "" };
    }

    const { text } = await generateText({
        model: getSmartModel(undefined, ctx.ctx),
        instructions: SEMANTIC_VERIFY_INSTRUCTIONS,
        prompt:
            `## instruction id\n\`${ictx.id}\`（${category.kind}）\n\n` +
            `## 关键上下文\n${semanticsBlock.join("\n\n")}\n\n` +
            `## 待审查的提示词\n${content}`,
    });

    const trimmed = text.trim();
    const ok = trimmed.toLowerCase().includes("__pass__") && trimmed.length < 40;
    return { ok, feedback: ok ? "" : trimmed };
}

function buildInitialPrompt(
    ictx: InstructionGenContext,
    category: InstructionCategory,
): string {
    const lines: string[] = [];

    lines.push(`## 工作流总目标`);
    lines.push(``);
    lines.push(ictx.flowIntent || "（未指定工作流目标）");
    lines.push(``);

    lines.push(`## 所属节点上下文`);
    lines.push(``);
    lines.push(`- 节点名称：${ictx.nodeName}`);
    lines.push(`- 节点动作：${ictx.nodeAction || "（未指定）"}`);
    lines.push(`- API 类型：${ictx.apiKind}`);
    lines.push(``);

    if (ictx.inputSemantics.length > 0) {
        lines.push(`### 输入产物及其语义`);
        lines.push(``);
        for (const sem of ictx.inputSemantics) {
            lines.push(`- \`${sem.name}\`${sem.role ? `——${sem.role}` : ""}`);
        }
        if (ictx.inputRelations.length > 0) {
            lines.push(``);
            lines.push(`输入产物的语义关系：`);
            for (const rel of ictx.inputRelations) {
                lines.push(`- \`${rel.name}\`：${rel.relationText}`);
            }
        }
        lines.push(``);
    }

    if (ictx.outputSemantics.length > 0) {
        lines.push(`### 输出产物及其语义`);
        lines.push(``);
        for (const sem of ictx.outputSemantics) {
            lines.push(`- \`${sem.name}\`${sem.role ? `——${sem.role}` : ""}`);
        }
        if (ictx.outputRelations.length > 0) {
            lines.push(``);
            lines.push(`输出产物的语义关系：`);
            for (const rel of ictx.outputRelations) {
                lines.push(`- \`${rel.name}\`：${rel.relationText}`);
            }
        }
        lines.push(``);
    }

    if (ictx.existingHint && ictx.existingHint.length > 100) {
        lines.push(`## compile 阶段已生成的初步提示词（供参考，必须保留硬性约束）`);
        lines.push(``);
        lines.push(ictx.existingHint);
        lines.push(``);
    }

    lines.push(`## 角色类别`);
    lines.push(``);
    if (category.kind === "writer") {
        lines.push(`本 instruction 是 **writer 类**（reAct 主思考角色）。`);
    } else if (category.kind === "reviewer") {
        lines.push(`本 instruction 是 **reviewer 类**（verify 评审角色，维度「${category.dimension}」）。`);
    } else if (category.kind === "extractor") {
        lines.push(`本 instruction 是 **extractor 类**（结构化提取）。`);
    } else {
        lines.push(`本 instruction 是通用角色。`);
    }
    lines.push(``);

    if (ictx.allInstructionsInNode.length > 1) {
        lines.push(`## 同节点的其它 instructions`);
        lines.push(``);
        for (const inst of ictx.allInstructionsInNode) {
            if (inst.id === ictx.id) continue;
            const suffix = inst.content && inst.content.length > 0 ? "（已有内容）" : "";
            lines.push(`- \`${inst.id}\`${suffix}`);
        }
        lines.push(``);
    }

    lines.push(`## 目标 instruction id`);
    lines.push(``);
    lines.push(`\`${ictx.id}\``);
    lines.push(``);

    lines.push(`请生成完整的系统提示词。`);

    return lines.join("\n");
}

const SEMANTIC_VERIFY_INSTRUCTIONS = `你是宽松的提示词语义评审专家。

任务：判断生成的提示词是否与节点上下文匹配、是否保留了 compile 阶段的关键约束。

判定标准（宽松）：
1. 输出产物语义是否被提及
2. 若 compile 阶段有硬性约束（如"返回5个""不超过30字"），新提示词是否保留
3. 整体语义是否与工作流总目标一致

输出规则：若完全满足，只输出"__PASS__"（不含引号）。若不满足，简要指出问题（3 句以内）。`;