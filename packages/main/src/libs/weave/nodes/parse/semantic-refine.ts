/**
 * weaver · parse · 语义整理
 *
 * 核心变更：
 * - 删除所有"提取跳转"的指令与反馈。控制流与约束一律以自然语言保留在「动作」段内。
 * - 新增"配置素材 vs 过程动作"二分规则：模板/公式/问题清单等固定素材提升为配置项
 *   （全局输入），完整逐字保留，并在消费步骤「输入」中按名引用——杜绝信息丢失。
 * - 新增输入自洽性要求：每个声明的「输入」都必须在「动作」中被真正引用。
 * - 反馈始终基于最新一轮 assistant 输出（messages 串联），不回灌历史文档。
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

    const messages: ModelMessage[] = previousMessages
        ? [...previousMessages]
        : [{ role: "user", content: initialPrompt }];

    if (externalFeedback.length > 0) {
        messages.push({
            role: "user",
            content:
                `## 上一轮整理结果在后续校验阶段未通过，以下问题必须修正：\n\n` +
                externalFeedback.map((f, i) => `${i + 1}. ${f}`).join("\n") +
                `\n\n请针对上述问题修正后，重新输出完整 markdown（从 # 工作流总标题 开始）。\n` +
                `- 未提及的部分保持不变\n` +
                `- 同一产物在所有步骤中必须逐字使用完全相同的名称\n` +
                `- 所有控制流与约束（若 X 则回到步骤 N / 否则继续 / 重复直到… / 各类质量校验）一律以自然语言保留在「动作」段里，不要拆成独立结构\n` +
                `- 原文的模板/公式/问题清单等固定素材不得丢弃：作为配置项写入「全局输入」（默认值存完整逐字内容），并在消费步骤的「输入」中按名引用\n` +
                `- 每个步骤声明的「输入」都必须在「动作」里被实际引用；未被使用的输入应删除\n` +
                `- 不要在 markdown 末尾添加任何"修正说明""回应"等额外段落——下游只处理从 # 开始的工作流正文`,
        });
    }

    const MAX_INTERNAL_ROUNDS = 3;

    for (let round = 1; round <= MAX_INTERNAL_ROUNDS; round++) {
        const { text: semanticDoc } = await generateText({
            model: getSmartModel(undefined, ctx.ctx),
            instructions: REFINE_INSTRUCTIONS,
            messages,
        });

        messages.push({ role: "assistant", content: semanticDoc });

        ctx.ctx.info?.(`[semanticRefine] round ${round} 整理完成，长度 ${semanticDoc.length}`);

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

        if (round < MAX_INTERNAL_ROUNDS) {
            messages.push({
                role: "user",
                content:
                    `你的整理结果存在以下问题，请逐条修正后重新输出完整 markdown：\n\n` +
                    check.issues.map((issue, i) => `${i + 1}. ${issue}`).join("\n") +
                    `\n\n要求：\n` +
                    `- 只修正问题点，未提及的部分保持不变\n` +
                    `- 产物名跨步骤必须逐字严格一致\n` +
                    `- 所有控制流与约束一律以自然语言保留在「动作」段内，不要单列\n` +
                    `- 模板/公式/问题清单等固定素材作为配置项写入「全局输入」，并在消费步骤「输入」中按名引用\n` +
                    `- 每个声明的「输入」必须在「动作」中被实际使用\n` +
                    `- 重新输出完整 markdown（从 # 工作流总标题 开始）`,
            });
        }
    }

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

const REFINE_INSTRUCTIONS = `你是工作流语义整理专家，负责把用户写的原始工作流文档整理为**清晰的自然语言 markdown**，让每个步骤的输入/输出/动作一目了然，且**任何原文信息都不丢失**。

## 一、你要做什么

1. **识别所有步骤**：原始文档中的步骤可能是段落、列表项、有序列表等形式，逐一识别，每个步骤对应一个二级标题。
2. **保留原文二级标题**：原文若有"## 1. xxx"就保留；没有则根据上下文给出合理步骤名。
3. **每个步骤讲清三件事**：
   - **输入**：这个步骤要用到哪些材料/产物/配置项？
   - **输出**：这个步骤产出什么？
   - **动作**：一段自然语言，完整描述本步骤怎么做，**包含原文里该步骤的所有条件分支、循环、跳转和质量约束**。
4. **跨步骤名称对齐**：同一个产物在所有步骤中用完全相同的名字，不要同义替换、不要缩写、不要用代词。

## 二、配置素材 vs 过程动作（极重要，决定信息是否丢失）

原文常混有两类内容，必须分别处理，任何一类都不能被概括或删掉：

**A. 固定可复用素材**（模板 / 公式清单 / 待回答问题清单 / 检查清单 / 示例库）
   - 判定标准：这是一块"可以被整体替换而不改变步骤逻辑"的固定内容，步骤只是去**填充它 / 回答它 / 套用它**。
   - 处理方式：提升为**全局输入里的配置项**。在文首"## 全局输入"下用 \`- 配置项 \\\`名称\\\`（默认：<完整逐字内容>）\` 登记，**默认值必须是该素材的完整原文，逐字保留，绝不概括、绝不省略**；然后在消费它的步骤「输入」中按同一名称引用。
   - 例：第 3 步的"结构化大纲模板"整块内容 → 配置项 \`结构化大纲模板\`（默认值 = 模板全文），第 3 步「输入」加入 \`结构化大纲模板\`。
   - 例：一组标题公式 → 配置项 \`标题公式库\`；一组待回答的定位问题 → 配置项 \`选题定位问题清单\`。

**B. 过程动作**（具体做什么、怎么判断、满足条件后去哪）
   - 处理方式：完整写在「动作」段的自然语言里。

## 三、控制流与约束——一律留在动作里，绝不单列（极重要）

本流程后续会被编译为代码，控制流会在编译期从动作文本中重新解析。因此：
- "若 X 则回到步骤 N / 返回步骤 M / 跳到某流程"、"否则继续"、"重复直到…"等控制流，**必须原样写在对应步骤「动作」段的自然语言里**；
- "字数不少于…"、"读起来要自然"、"外行要能看懂"等质量约束，同样写在「动作」里；
- **绝不要**把跳转、条件、约束抽成单独的"跳转"字段或章节——只需保证它们完整存在于动作文本中即可。

## 四、输入的自洽性

- 每个步骤声明的「输入」必须在该步骤「动作」中被真正用到（按名引用）；
- **不要臆造宽泛的背景输入**（如"通用常识""个人经验"这类无法在动作中被具体引用的项）——若动作没有具体使用某个输入，就不要声明它。

## 五、输出格式（自然语言，不要求精确格式）

\`\`\`markdown
# <工作流总标题>

<一段话描述本工作流的总目标>

---

## 全局输入

- 输入项 \`<需外部提供、无固定内容的初始材料>\`
- 配置项 \`<固定素材名>\`（默认：<该素材的完整逐字内容>）

## 1. <步骤名>

- 输入：<列出本步骤所有输入/配置项，用反引号包裹名称>
- 输出：<列出本步骤所有输出，用反引号包裹名称>
- 动作：<一段话，完整描述本步骤做什么，包含所有条件分支、循环、跳转与约束>

## 2. <步骤名>

...
\`\`\`

## 六、关键约束

1. **同一产物在所有步骤中用同一个名字**——最重要的对齐要求。
2. **跳转、条件分支、约束——全部以自然语言写在「动作」里，不单列**。
3. **模板/公式/问题清单等固定素材不得丢弃**——提为配置项，默认值存完整原文。
4. **步骤顺序就是执行顺序**。
5. **每个步骤都必须有输入、输出、动作三项，动作不能为空、不能遗漏原文细节**。
6. **动作中提及的每个产物（反引号包裹）必须在该步骤输入或输出中声明；每个声明的输入必须在动作中被使用**。

## 七、输出要求

- **只输出 markdown 正文**，从 \`# <工作流总标题>\` 开始。
- **不要输出 JSON**，不要用代码块包裹整个文档。
- **不要输出任何"以下是整理结果""修正说明"之类的元信息**。`;