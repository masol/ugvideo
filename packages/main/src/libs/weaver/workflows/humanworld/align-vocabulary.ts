/**
 * weaver · 阶段 ⑤ align-vocabulary
 *
 * 跨步骤统一命名：artifact 名、动作动词、宾语。
 * KB 命中即复用，未命中经 LLM 兜底。
 */

import { getSmartModel } from '$libs/model/balancer/get-smart-model.js';
import { generateText } from 'ai';
import type { WeaveContext } from '../../shared/weave-context.js';

const ALIGN_INSTRUCTIONS = `你是词汇对齐专家。给定多步骤的 IO 描述，统一命名规范。

## 输出格式（markdown）

**alias**：{同义词1}、{同义词2}
**canonical**：\`{ 权威名 }\`
**reason**：{为什么用这个权威名}

对每组需要对齐的词汇输出一段。

只输出对齐结果。`;

export async function alignVocabulary(
    ctx: WeaveContext,
    ioText: string,
): Promise<string> {
    const cached = ctx.storage.getVocabAlignment();
    if (cached) return cached;

    // KB 快速路径：所有 artifact 名都在 KB 中 → 无需 LLM
    const artifactNames = extractArtifactNames(ioText);
    const allKnown = artifactNames.length > 0 && artifactNames.every(
        name => ctx.kb.searchConceptDedupe(`${name} | aligned`) !== null,
    );
    if (allKnown) {
        const empty = 'all aligned (kb hit)';
        ctx.storage.saveVocabAlignment(empty);
        return empty;
    }

    const model = getSmartModel(undefined, ctx.ctx);
    const { text } = await generateText({
        model,
        instructions: ALIGN_INSTRUCTIONS,
        prompt: `## 各步骤 IO 描述：\n${ioText}`,
    });

    ctx.storage.saveVocabAlignment(text);
    return text;
}

function extractArtifactNames(text: string): string[] {
    const names: string[] = [];
    const re = /`([^`]+)`/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) {
        names.push(m[1]);
    }
    return names;
}