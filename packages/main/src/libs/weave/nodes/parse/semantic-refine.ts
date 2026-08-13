/**
 * weaver · parse · 语义整理（v14）
 *
 * 核心改动（v14）：
 * - 修正反馈回灌 bug：原逻辑仅在 previousMessages === undefined 时注入 externalFeedback，
 *   导致外层第 2 轮及以后的 DAG/抽取反馈被丢弃、reAct 空转。改为反馈存在即注入一轮 user 消息。
 *
 * 保留：
 * - messages 数组维护多轮对话
 * - 内部 3 轮自检 reAct（名称对齐 / 可行性 / 完整性）
 * - 产出自然语言 markdown（不要求任何精确格式；结构化交给下游 safefmt）
 */

import { getSmartModel } from "$libs/model/balancer/get-smart-model.js";
import type { ModelMessage } from "ai";
import { generateText } from "ai";
import type { WeaveContext } from "../../context.js";
import { semanticSelfCheck } from "./semantic-self-check.js";

export interface SemanticRefineResult {
    doc: string;
    messages: ModelMessage[];
}

export async function semanticRefine(
    ctx: WeaveContext,
    doc: string,
    goal: string | null,
    constraints: string | null,
    preferences: string | null,
    externalFeedback: string[],
    previousMessages?: ModelMessage[],
): Promise<SemanticRefineResult> {
    const contextBlock = buildContextBlock(goal, constraints, preferences);
    const initialPrompt = `${contextBlock}\n\n## 原始工作流文档\n${doc}`.trim();

    // 初始化或延续 messages
    const messages: ModelMessage[] = previousMessages
        ? [...previousMessages]
        : [{ role: "user", content: initialPrompt }];

    // 外层反馈（DAG 验证失败 / safefmt 抽取失败等）——只要存在就作为一轮 user 消息注入，
    // 无论是首轮还是延续对话，确保反馈真正被模型看到。
    if (externalFeedback.length > 0) {
        messages.push({
            role: "user",
            content:
                `## 上一轮整理出的工作流在后续校验阶段未通过，以下问题必须修正：\n` +
                externalFeedback.map((f, i) => `${i + 1}. ${f}`).join("\n") +
                `\n\n请针对上述问题修正后，重新输出完整 markdown（从 # 工作流总标题 开始）。\n` +
                `- 未提及的部分保持不变\n` +
                `- 同一产物在所有步骤中必须逐字使用完全相同的名称\n` +
                `- 跳转、条件分支全部内蕴在「动作」自然语言里`,
        });
    }

    const MAX_INTERNAL_ROUNDS = 3;

    for (let round = 1; round <= MAX_INTERNAL_ROUNDS; round++) {
        // ── 1. LLM 整理 ──
        const { text: semanticDoc } = await generateText({
            model: getSmartModel(undefined, ctx.ctx),
            instructions: REFINE_INSTRUCTIONS,
            messages,
        });

        messages.push({ role: "assistant", content: semanticDoc });

        ctx.ctx.info?.(`[semanticRefine] round ${round} 整理完成，长度 ${semanticDoc.length}`);

        // ── 2. 内部自检 ──
        const check = semanticSelfCheck(semanticDoc, ctx);

        if (check.issues.length === 0) {
            ctx.ctx.info?.(
                `[semanticRefine] round ${round} 自检通过（${check.checkedSteps} 步骤）`,
            );
            return { doc: semanticDoc, messages };
        }

        ctx.ctx.info?.(
            `[semanticRefine] round ${round} 自检未通过：${check.issues.length} 条问题`,
        );

        // ── 3. 反馈回灌（带回 messages，让 LLM 局部修正）──
        if (round < MAX_INTERNAL_ROUNDS) {
            messages.push({
                role: "user",
                content:
                    `你的整理结果存在以下问题，请逐条修正后重新输出完整 markdown：\n\n` +
                    check.issues.map((issue, i) => `${i + 1}. ${issue}`).join("\n") +
                    `\n\n要求：\n` +
                    `- 只修正问题点，未提及的部分保持不变\n` +
                    `- 产物名跨步骤必须逐字严格一致\n` +
                    `- 跳转、条件分支全部内蕴在「动作」自然语言里\n` +
                    `- 重新输出完整 markdown（从 # 工作流总标题 开始）`,
            });
        }
    }

    // 3 轮仍有问题：返回最新版（交给外层 reAct 继续处理）
    const lastDoc = messages[messages.length - 1];
    const finalDoc = lastDoc?.role === "assistant" ? (lastDoc.content as string) : doc;
    return { doc: finalDoc, messages };
}

function buildContextBlock(
    goal: string | null,
    constraints: string | null,
    preferences: string | null,
): string {
    const lines: string[] = [];
    if (goal) lines.push(`## 工作流目标\n${goal}`);
    if (constraints) lines.push(`## 硬性约束\n${constraints}`);
    if (preferences) lines.push(`## 偏好与权衡\n${preferences}`);
    return lines.length > 0 ? lines.join("\n\n") : "";
}

const REFINE_INSTRUCTIONS = `你是工作流语义整理专家，负责把用户写的原始工作流文档整理为**清晰的自然语言 markdown**，让每个步骤的输入/输出/动作一目了然。

## 一、你要做什么

1. **识别所有步骤**：原始文档中的步骤可能是段落、列表项、有序列表等形式，你要把它们逐一识别出来，每个步骤对应一个二级标题。
2. **保留原文的二级标题**：如果原文已经有"## 1. xxx"这样的标题，请保留；如果没有，请根据上下文给出合理的步骤名。
3. **在每个步骤下，把三件事讲清楚**：
   - **输入**：这个步骤需要用到什么材料/产物？
   - **输出**：这个步骤产出什么？
   - **动作**：这个步骤具体做什么？（一段话描述，包含原文中"若 xx 则 yy"的所有条件分支，全部内蕴在这一段里，不要遗漏任何细节）
4. **跨步骤名称对齐**：同一个产物在所有步骤中必须用完全相同的名字，不要同义词替换、不要缩写、不要用代词。例如"暂定标题"在所有步骤中都叫"暂定标题"。
5. **标出全局输入**：那些不由任何步骤产出、需要从外部提供的初始材料，请在文首用一句话说明它们是外部输入。

## 二、输出格式（自然语言，不要求精确格式）

\`\`\`markdown
# <工作流总标题>

<一段话描述本工作流的总目标；如有外部提供的初始输入，在此一并说明>

---

## 1. <步骤名>

- 输入：<列出本步骤的所有输入，用自然语言>
- 输出：<列出本步骤的所有输出，用自然语言>
- 动作：<一段话描述本步骤做什么，包含所有条件分支>

## 2. <步骤名>

...
\`\`\`

## 三、关键约束

1. **同一产物在所有步骤中用同一个名字**——这是最重要的对齐要求。
2. **跳转、条件分支、约束——全部写在「动作」里**，用自然语言描述。
3. **步骤顺序就是执行顺序**。
4. **每个步骤都必须有输入、输出、动作三项，且动作不能为空、不能遗漏原文细节**。

## 四、输出要求

- **只输出 markdown 正文**，从 \`# <工作流总标题>\` 开始。
- **不要输出 JSON**，不要用代码块包裹整个文档。
- **不要输出任何"以下是整理结果"之类的元信息**。`;