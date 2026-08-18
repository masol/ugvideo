/**
 * weaver · generate-instructions · 单个 instruction 生成器（reAct 模式）
 *
 * v8 修复：
 * - 修正 generic 失败后直接保存最后 assistant 的问题
 * - 修正 generic 结构检查过于单一的问题
 * - 区分 writer / reviewer / extractor / generic 的最低结构要求
 * - 允许 validator 类 reviewer 使用验证职责，不必强制出现反馈建议字样
 * - 语义审查反馈改为结构化约束反馈
 */

import { getSmartModel } from "$libs/model/balancer/get-smart-model.js";
import { generateText, type ModelMessage } from "ai";
import type { WeaveContext } from "../../context.js";
import type { InstructionGenContext } from "./index.js";
import META_GENERIC_INSTRUCTIONS from "./prompts/meta-generic-instructions.txt?raw";
import META_REVIEWER_INSTRUCTIONS from "./prompts/meta-reviewer-instructions.txt?raw";
import META_WRITER_INSTRUCTIONS from "./prompts/meta-writer-instructions.txt?raw";

const MAX_ROUNDS = 3;

const PASS_MARKER = "__PASS__";

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

        const structureCheck = structuralCheck(text, category);
        if (!structureCheck.ok) {
            if (round < MAX_ROUNDS - 1) {
                messages.push({
                    role: "user",
                    content: structureCheck.feedback,
                });

                ctx.ctx.info(
                    `[generateInstruction] 「${ictx.id}」第 ${round + 1} 轮结构检查未通过：` +
                    structureCheck.feedback.slice(0, 120),
                );
            }

            continue;
        }

        const semanticCheck = await semanticCheckWithLLM(
            ctx,
            ictx,
            text,
            category,
        );

        if (semanticCheck.ok) {
            return text.trim();
        }

        if (round < MAX_ROUNDS - 1) {
            messages.push({
                role: "user",
                content: semanticCheck.feedback,
            });

            ctx.ctx.info(
                `[generateInstruction] 「${ictx.id}」第 ${round + 1} 轮语义评审未通过：` +
                semanticCheck.feedback.slice(0, 120),
            );
        }
    }

    ctx.ctx.info(
        `[generateInstruction] 「${ictx.id}」${MAX_ROUNDS} 轮 reAct 均未通过，返回兜底 instruction`,
    );

    if (category.kind === "reviewer") {
        return buildFallbackReviewerInstruction(ictx);
    }

    return buildFallbackInstruction(ictx);
}

export type InstructionCategory =
    | { kind: "writer" }
    | { kind: "reviewer"; dimension: string }
    | { kind: "extractor" }
    | { kind: "generic" };

/** 导出供 generate-instructions 编排器使用（落盘分类信息） */
export function classifyInstructionForStorage(
    id: string,
): InstructionCategory {
    return classifyInstruction(id);
}

function classifyInstruction(
    id: string,
): InstructionCategory {
    if (id.includes("_reviewer")) {
        const m = id.match(/_([a-z_]+)_reviewer$/);
        const dimension = m ? m[1] : "general";

        return {
            kind: "reviewer",
            dimension,
        };
    }

    if (id.includes("_writer")) {
        return { kind: "writer" };
    }

    if (id.includes("_extractor")) {
        return { kind: "extractor" };
    }

    return { kind: "generic" };
}

function selectMetaInstructions(
    category: InstructionCategory,
): string {
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

/**
 * 结构检查。
 *
 * 最低要求按角色区分：
 * - writer：角色、目标、输入、输出、修正指导
 * - reviewer：角色、评审标准、验证或反馈职责
 * - extractor：角色、目标、输入、抽取输出
 * - generic：角色、任务、输入、输出
 */
function structuralCheck(
    text: string,
    category: InstructionCategory,
): CheckResult {
    const trimmed = text.trim();
    const issues: string[] = [];

    const hasRole =
        /角色|身份|你是/i.test(trimmed);

    if (!hasRole) {
        issues.push("缺少「角色/身份」相关描述");
    }

    if (category.kind === "writer") {
        if (!/目标|任务|职责|核心动作/i.test(trimmed)) {
            issues.push("writer 类缺少「目标/任务/职责」相关描述");
        }

        if (!/输入/.test(trimmed)) {
            issues.push("writer 类缺少「输入」相关描述");
        }

        if (!/输出/.test(trimmed)) {
            issues.push("writer 类缺少「输出」相关描述");
        }

        if (!/反馈|修正|上一轮|上轮|根据.*修订/i.test(trimmed)) {
            issues.push("writer 类缺少「多轮修正指导」相关描述");
        }
    }

    if (category.kind === "reviewer") {
        if (!/目标|任务|职责|评审|验证|检查|审查/i.test(trimmed)) {
            issues.push("reviewer 类缺少「评审/验证任务」相关描述");
        }

        if (
            !/评审标准|判定标准|判断标准|评估标准|审查标准|验证规则|检查规则/i.test(
                trimmed,
            )
        ) {
            issues.push(
                'reviewer 类缺少"评审标准/判定标准/验证规则"相关描述',
            );
        }

        const isValidator =
            ictxIdLooksLikeValidator(
                trimmed,
            );

        if (
            !isValidator &&
            !/反馈|修改建议|指出问题|不满足|不通过|异常处理/i.test(
                trimmed,
            )
        ) {
            issues.push(
                "reviewer 类缺少「反馈/修改建议」或明确的验证职责描述",
            );
        }
    }

    if (category.kind === "extractor") {
        if (!/目标|任务|职责|抽取|提取/i.test(trimmed)) {
            issues.push("extractor 类缺少「任务/抽取」相关描述");
        }

        if (!/输入/.test(trimmed)) {
            issues.push("extractor 类缺少「输入」相关描述");
        }

        if (!/输出|抽取|提取/i.test(trimmed)) {
            issues.push("extractor 类缺少「输出/抽取」相关描述");
        }
    }

    if (category.kind === "generic") {
        if (!/目标|任务|职责|核心动作|处理规则/i.test(trimmed)) {
            issues.push("generic 类缺少「目标/任务/处理规则」相关描述");
        }

        if (!/输入/.test(trimmed)) {
            issues.push("generic 类缺少「输入」相关描述");
        }

        if (!/输出/.test(trimmed)) {
            issues.push("generic 类缺少「输出」相关描述");
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
            feedback:
                `结构检查未通过：\n` +
                issues
                    .map((s, i) => `${i + 1}. ${s}`)
                    .join("\n") +
                `\n\n请修正后重新输出完整提示词。`,
        };
    }

    return {
        ok: true,
        feedback: "",
    };
}

function ictxIdLooksLikeValidator(
    text: string,
): boolean {
    return (
        /质检|验证|校验|检查器|validator|compliance|quote|金句|标签|字数|格式/i.test(
            text,
        )
    );
}

async function semanticCheckWithLLM(
    ctx: WeaveContext,
    ictx: InstructionGenContext,
    content: string,
    category: InstructionCategory,
): Promise<CheckResult> {
    const semanticsBlock: string[] = [];

    if (ictx.flowIntent) {
        semanticsBlock.push(
            `工作流总目标：${ictx.flowIntent.slice(0, 200)}`,
        );
    }

    if (ictx.outputSemantics.length > 0) {
        semanticsBlock.push(
            `输出产物：${ictx.outputSemantics
                .map(
                    (s) =>
                        `\`${s.name}\`(${s.role || "无语义"})`,
                )
                .join("、")}`,
        );
    }

    if (ictx.existingHint && ictx.existingHint.length > 100) {
        semanticsBlock.push(
            `compile 阶段已有约束：\n${ictx.existingHint.slice(0, 1000)}`,
        );
    }

    if (semanticsBlock.length === 0) {
        return {
            ok: true,
            feedback: "",
        };
    }

    const { text } = await generateText({
        model: getSmartModel(undefined, ctx.ctx),
        instructions: SEMANTIC_VERIFY_INSTRUCTIONS,
        prompt:
            `## instruction id\n` +
            `\`${ictx.id}\`（${category.kind}）\n\n` +
            `## 关键上下文\n` +
            semanticsBlock.join("\n\n") +
            `\n\n## 待审查的提示词\n` +
            content,
    });

    const trimmed = text.trim();
    const normalized = trimmed.toLowerCase();

    const passed =
        normalized.includes(PASS_MARKER.toLowerCase()) &&
        trimmed.length < 80;

    if (passed) {
        return {
            ok: true,
            feedback: "",
        };
    }

    return {
        ok: false,
        feedback: normalizeSemanticFeedback(
            trimmed,
            category,
        ),
    };
}

/**
 * 将自由文本反馈整理为生成器更容易执行的格式。
 *
 * 不追求完整保留模型原话，只保留可执行约束。
 */
function normalizeSemanticFeedback(
    text: string,
    category: InstructionCategory,
): string {
    const lines = text
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean)
        .filter(
            (line) =>
                !line.includes("如果") &&
                !line.includes("建议")
        );

    const issueText =
        lines.length > 0
            ? lines.join("\n")
            : "语义审查未通过：请重新核对输入、输出、角色职责和已有硬性约束。";

    if (category.kind === "reviewer") {
        return (
            `语义审查未通过。\n` +
            `请保留以下关键要求，不要削弱或改写其语义：\n` +
            `${issueText}\n\n` +
            `只修正反馈中指出的问题，未提及的内容保持不变；` +
            `重新输出完整系统提示词。`
        );
    }

    return (
        `语义审查未通过。\n` +
        `请根据以下问题修正，并重新输出完整系统提示词：\n` +
        `${issueText}\n\n` +
        `只修正反馈中指出的问题，未提及的内容保持不变。`
    );
}

function buildInitialPrompt(
    ictx: InstructionGenContext,
    category: InstructionCategory,
): string {
    const lines: string[] = [];

    lines.push("## 工作流总目标");
    lines.push("");
    lines.push(ictx.flowIntent || "（未指定工作流目标）");
    lines.push("");

    lines.push("## 所属节点上下文");
    lines.push("");
    lines.push(`- 节点名称：${ictx.nodeName}`);
    lines.push(`- 节点动作：${ictx.nodeAction || "（未指定）"}`);
    lines.push(`- API 类型：${ictx.apiKind}`);
    lines.push("");

    if (ictx.inputSemantics.length > 0) {
        lines.push("### 输入产物及其语义");
        lines.push("");

        for (const sem of ictx.inputSemantics) {
            lines.push(
                `- \`${sem.name}\`${sem.role ? `——${sem.role}` : ""}`,
            );
        }

        if (ictx.inputRelations.length > 0) {
            lines.push("");
            lines.push("输入产物的语义关系：");

            for (const rel of ictx.inputRelations) {
                lines.push(
                    `- \`${rel.name}\`：${rel.relationText}`,
                );
            }
        }

        lines.push("");
    }

    if (ictx.outputSemantics.length > 0) {
        lines.push("### 输出产物及其语义");
        lines.push("");

        for (const sem of ictx.outputSemantics) {
            lines.push(
                `- \`${sem.name}\`${sem.role ? `——${sem.role}` : ""}`,
            );
        }

        if (ictx.outputRelations.length > 0) {
            lines.push("");
            lines.push("输出产物的语义关系：");

            for (const rel of ictx.outputRelations) {
                lines.push(
                    `- \`${rel.name}\`：${rel.relationText}`,
                );
            }
        }

        lines.push("");
    }

    if (ictx.existingHint && ictx.existingHint.length > 100) {
        lines.push(
            "## compile 阶段已有提示词及约束（必须保留其中的硬性要求语义）",
        );
        lines.push("");
        lines.push(ictx.existingHint);
        lines.push("");
    }

    lines.push("## 角色类别");
    lines.push("");

    if (category.kind === "writer") {
        lines.push(
            "本 instruction 是 **writer 类**（reAct 主思考角色）。",
        );
    } else if (category.kind === "reviewer") {
        lines.push(
            `本 instruction 是 **reviewer 类**（verify 评审角色，维度「${category.dimension}」）。`,
        );
    } else if (category.kind === "extractor") {
        lines.push(
            "本 instruction 是 **extractor 类**（结构化提取）。",
        );
    } else {
        lines.push("本 instruction 是 **generic 类**（通用执行角色）。");
    }

    lines.push("");

    if (ictx.allInstructionsInNode.length > 1) {
        lines.push("## 同节点的其它 instructions");
        lines.push("");

        for (const inst of ictx.allInstructionsInNode) {
            if (inst.id === ictx.id) {
                continue;
            }

            const suffix =
                inst.content && inst.content.length > 0
                    ? "（已有内容）"
                    : "";

            lines.push(`- \`${inst.id}\`${suffix}`);
        }

        lines.push("");
    }

    lines.push("## 目标 instruction id");
    lines.push("");
    lines.push(`\`${ictx.id}\``);
    lines.push("");

    lines.push("请生成完整的系统提示词。");

    return lines.join("\n");
}

function buildFallbackReviewerInstruction(
    ictx: InstructionGenContext,
): string {
    const nodeOutputs =
        ictx.outputSemantics.length > 0
            ? ictx.outputSemantics
                .map((s) => `\`${s.name}\``)
                .join("、")
            : "本节点的输出产物";

    return (
        `你是评审专家（兜底 instruction）。\n\n` +
        `**任务**：评审输入文本是否满足「${ictx.nodeName}」节点的产出要求。\n\n` +
        `**评审标准**：\n` +
        `1. 内容完整性：是否覆盖 ${nodeOutputs} 的所有关键要素。\n` +
        `2. 格式合规：是否符合该产物类型的常规格式规范。\n` +
        `3. 质量底线：是否满足工作流「${ictx.flowIntent?.slice(0, 50) ?? "总目标"}」的基本要求。\n\n` +
        `**反馈要点**：若不满足上述标准，明确指出问题片段并给出重写方向。`
    );
}

function buildFallbackInstruction(
    ictx: InstructionGenContext,
): string {
    return (
        `你是工作流步骤「${ictx.nodeName}」的执行专家。\n\n` +
        `**任务**：完成本步骤要求的工作，并产出符合节点声明的结果。\n\n` +
        `**输入**：使用本步骤声明的输入产物及其语义，不得臆造不存在的输入。\n\n` +
        `**输出**：产出本步骤声明的输出产物，key 必须与节点声明逐字一致。\n\n` +
        `**处理规则**：\n` +
        `1. 保留输入产物中的有效信息，不得无故丢失。\n` +
        `2. 只完成本步骤职责，不执行后续步骤。\n` +
        `3. 若上一轮反馈指出了具体问题，只针对反馈修正，并重新输出完整结果。`
    );
}

const SEMANTIC_VERIFY_INSTRUCTIONS = `你是提示词语义审查专家。

任务：只审查以下内容，不要自行重构，也不要要求措辞逐字一致：

1. 提示词是否与节点目标、输入产物、输出产物语义一致。
2. 提示词是否保留 compile 阶段已经明确的关键硬约束。
3. writer 是否保留多轮修正职责。
4. reviewer 是否具备评审或验证职责，并能在不满足时给出判断。
5. 是否没有把配置项、外部输入或过程产物错误地当成最终输出。
6. 不得把建议性措辞擅自提升为硬性约束。

判定原则：
- 同义改写、措辞优化、角色名称润色不算违规。
- 只要关键约束语义仍存在，不得仅因文字不完全一致判失败。
- 只有确实缺少、削弱、冲突或改变了关键约束时，才判失败。
- reviewer 负责验证时，不必要求其同时提供改写方案。
- 不要检查 \`__PASS__\` 字面量，它由运行框架统一追加。

反馈规则：
若满足全部条件，只输出 "__PASS__"。
若不满足，输出 1-3 条最重要的问题，每条以以下类别开头：
- MISSING_CONSTRAINT
- ROLE_DRIFT
- OUTPUT_MISMATCH
- REVIEWER_DUTY_MISSING
- SEMANTIC_CONFLICT

只写必须修正的问题，不要输出“建议”“如果”“可以优化”等泛化描述。`;