/**
 * weaver · parse · LLM 路径（reAct）
 *
 * 目标：把 NL 工作流转为标准格式 markdown。
 * 内部维护 reAct 循环（messages + ConflictSignal）。
 */

import { getSmartModel } from '$libs/model/balancer/get-smart-model.js';
import { generateText, type ModelMessage } from 'ai';
import type { WeaveContext } from '../../context.js';
import { ConflictSignal } from '../../types.js';
import { parseMarkdown } from './index.js';
import { tryStandard } from './standard.js';

export async function runLLMReact(
    ctx: WeaveContext,
    initialErrors: string[],
): Promise<string[]> {
    const messages: ModelMessage[] = [{
        role: 'user',
        content: contextWithFeedback(ctx.globalGoal, initialErrors),
    }];

    for (let round = 1; round <= ctx.config.maxReactRounds; round++) {
        ctx.notify('llm-to-standard', `第 ${round} 轮`);

        try {
            const { text } = await generateText({
                model: getSmartModel(undefined, ctx.ctx),
                instructions: SYSTEM_INSTRUCTIONS,
                messages,
            });

            // 验证：必须是合法标准格式
            const tree = parseMarkdown(text);
            const validation = tryStandard(tree, ctx);
            if (!validation.flow) {
                throw new ConflictSignal(validation.errors.join('\n'));
            }

            return [text];
        } catch (e) {
            if (e instanceof ConflictSignal) {
                refeed(messages, e.feedback);
                ctx.warn(`[llm-to-standard] 第 ${round} 轮未过：\n${e.feedback.substring(0, 200)}`);
                continue;
            }
            throw e;
        }
    }

    throw new Error(`[llm-to-standard] ${ctx.config.maxReactRounds} 轮未收敛`);
}

function refeed(messages: ModelMessage[], feedback: string): void {
    messages.push({
        role: 'user',
        content: `你的产出存在以下问题：\n${feedback}\n\n请修正后重新输出完整的工作流。保持无问题部分不变，不要引入新问题。`,
    });
}

function contextWithFeedback(globalGoal: string, errors: string[]): string {
    if (errors.length === 0) {
        return `## 工作流文档：\n${globalGoal}`;
    }
    return `## 上一轮反馈：\n${errors.join('\n')}\n\n## 工作流文档：\n${globalGoal}`;
}

const SYSTEM_INSTRUCTIONS = `你是工作流格式转换器。给定自然语言工作流文档，输出严格遵循标准格式的 markdown。

## 标准格式（强制）

# {工作流名}

{总则 —— 1~2 句话说明目标}

---

## 全局输入

- 配置项 \`{key}\`（默认：{value}）
- 输入项 \`{key}\`

## 1. {步骤名}

- 目的：...
- 输入：\`a\` \`b\`
- 输出：\`c\`
- 动作：...
- 跳转：
  - 若 \`{condition}\` → 步骤 N
  - 否则 → 步骤 M / 结束

## 2. {步骤名}

（每一步骤独立成段）

## 关键规则

1. 一级标题必须恰好 1 个（工作流名）
2. 必须有「全局输入」段（无全局输入可省略，但从缺省角度建议保留空段）
3. 步骤段标题必须为顺序编号：「1. xxx」「2. xxx」
4. 每步必填字段：目的 / 输入 / 输出 / 动作
5. 跳转段可选；若写则每行以「- 」开头
6. artifact 名必须用反引号包裹：\`xxx\`
7. 严禁输出 JSON，原样输出 markdown`;