/**
 * weaver · 阶段 ③ identify-step-output
 *
 * 对每个步骤确定 IO。
 */

import { getSmartModel } from '$libs/model/balancer/get-smart-model.js';
import { generateText } from 'ai';
import type { WeaveContext } from '../../shared/weave-context.js';

const STEP_OUTPUT_INSTRUCTIONS = `你是步骤 IO 识别专家。给定步骤描述和上游已产出的 artifact 名清单，确定本步骤的输入/输出。

## 关键规则
- **优先复用上游已产出 artifact 名**——不要另造新词
- 每个步骤恰好 1 个输出（除非明确多输出）
- 如果需要新 artifact（上游没有），在输出中列出 name + intent

## 输出格式（markdown）

对每个步骤输出：

**步骤 {order}：{name}**
- inputs：\`{ a }\` \`{ b } \`
- outputs：\`{ c } \`
- new_artifacts（如有）：\`{ name } \` = {intent}

只输出 IO 识别结果。`;

export async function identifyStepOutputs(
    ctx: WeaveContext,
    stepsText: string,
    upstreamArtifactNames: string[],
): Promise<string> {
    const cached = ctx.storage.getStepOutputs();
    if (cached) return cached;

    const model = getSmartModel(undefined, ctx.ctx);
    const upstreamStr = upstreamArtifactNames.join(', ');

    const { text } = await generateText({
        model,
        instructions: STEP_OUTPUT_INSTRUCTIONS,
        prompt: `## 上游已产出 artifact：\n${upstreamStr}\n\n## 步骤列表：\n${stepsText}`,
    });

    ctx.storage.saveStepOutputs(text);
    return text;
}