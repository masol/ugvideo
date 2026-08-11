/**
 * weaver · 阶段 ② collect-macro
 *
 * LLM 阅读工作流全局，收集宏观信息（目标、适用场景、依赖等）。
 */

import { getSmartModel } from '$libs/model/balancer/get-smart-model.js';
import { generateText } from 'ai';
import type { WeaveContext } from '../../shared/weave-context.js';

const COLLECT_MACRO_INSTRUCTIONS = `你是工作流宏观信息收集专家。阅读完整工作流文档，输出工作流级信息。

## 你的产物（markdown）

## 目标
{一句话目标}

## 适用场景
- {场景1}
- {场景2}

## 前置条件
- {条件1}

## 全局约束
- {约束1}

## 与其他工作流的关系
- {关系1}

只输出宏观信息，禁止输出步骤级细节。`;

export async function collectMacro(
    ctx: WeaveContext,
    docText: string,
): Promise<string> {
    const cached = ctx.storage.getMacroInfo();
    if (cached) return cached;

    const model = getSmartModel(undefined, ctx.ctx);
    const { text } = await generateText({
        model,
        instructions: COLLECT_MACRO_INSTRUCTIONS,
        prompt: `## 工作流文档：\n${docText}`,
    });

    ctx.storage.saveMacroInfo(text);
    return text;
}