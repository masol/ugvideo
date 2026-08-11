/**
 * weaver · node ① parse
 *
 * 统一入口：markdown → HumanFlow[]
 * 流程：
 *   1. parseMarkdown() → MDAST
 *   2. 尝试标准格式 tryStandard(MDAST) → 成功则返回
 *   3. 失败 → LLM 路径 runLLMReact() → 标准 markdown
 *   4. 重新 parseMarkdown + tryStandard
 */

import { PrjDB } from '$libs/project/controllers/drizzle/index.js';
import type { Root } from 'mdast';
import remarkParse from 'remark-parse';
import { unified } from 'unified';
import type { WeaveContext } from '../../context.js';
import type { HumanFlow } from '../../types.js';
import { runLLMReact } from './llm.js';
import { tryStandard } from './standard.js';

export async function parseWorkflow(ctx: WeaveContext): Promise<HumanFlow[]> {
    const docs = ctx.inputDocs;
    const flows: HumanFlow[] = [];
    const allErrors: string[] = [];

    // 阶段 1：标准格式尝试
    for (let i = 0; i < docs.length; i++) {
        const doc = docs[i];
        const tree = parseMarkdown(doc);
        const result = tryStandard(tree, ctx);

        if (result.flow) {
            flows.push(result.flow);
        } else {
            allErrors.push(`工作流 ${i + 1}：${result.errors.join('; ')}`);
        }
    }

    if (allErrors.length === 0) {
        ctx.notify('parse', `标准格式命中，共 ${flows.length} 个工作流`);
        return flows;
    }

    // 阶段 2：LLM 路径
    ctx.notify('parse', `标准格式未命中，转 LLM 路径`);
    const standardDocs = await runLLMReact(ctx, allErrors);

    // 写回 prjdb.set('script', [...])（对齐 prod2adimg）
    const prjdb = PrjDB.ensure(ctx.ctx.prj);
    prjdb.set('script', standardDocs);

    // 阶段 3：重新解析
    const finalFlows: HumanFlow[] = [];
    for (let i = 0; i < standardDocs.length; i++) {
        const doc = standardDocs[i];
        const tree = parseMarkdown(doc);
        const result = tryStandard(tree, ctx);

        if (!result.flow) {
            throw new Error(`[parse] LLM 路径仍未产出合法标准格式：${result.errors.join('; ')}`);
        }
        finalFlows.push(result.flow);
    }

    return finalFlows;
}

export function parseMarkdown(markdown: string): Root {
    return unified().use(remarkParse).parse(markdown);
}