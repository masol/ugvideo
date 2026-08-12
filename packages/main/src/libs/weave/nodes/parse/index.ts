/**
 * weaver · node ① parse
 *
 * 整体门控逻辑：
 * - 输入：script
 * - 输出：parsed_docs_index（所有文档 id 的数组）
 *
 * 门控过：
 *   读取所有缓存的标准文档 → 逐个解析 → 验证 → 注册到 ConceptManager
 *
 * 门控未过：
 *   读取所有原始文档 → 逐个解析 → 验证 → 注册到 ConceptManager → 导出标准格式 → 缓存
 */

import { checkExpiry } from "$libs/blueprint/glossary/expiry.js";
import type { WeaveContext } from "../../context.js";
import { errorsToString, validateHumanFlow } from "../../graph/validate.js";
import { exportToStandardFormat } from "./export-standard.js";
import { parseMarkdown, tryStandard } from "./standard.js";

export async function parseWorkflow(ctx: WeaveContext): Promise<void> {
    const docs = ctx.inputDocs;
    const outputKey = ctx.storage.workflow.latestKey("parsed_docs_index");

    // 整体门控
    const shouldSkip = !checkExpiry(ctx.ctx, {
        inputKeys: "script",
        outputKeys: outputKey,
    });

    if (shouldSkip) {
        // 门控过 → 读缓存的标准文档集合
        const cachedIndex = ctx.storage.workflow.getParsedDocsIndex();
        if (cachedIndex && cachedIndex.length === docs.length) {
            ctx.ctx.notify("parse", `命中缓存，共 ${cachedIndex.length} 个文档`);

            // 逐个读取标准文档并解析
            for (let i = 0; i < cachedIndex.length; i++) {
                const standardDoc = ctx.storage.workflow.getStandardDoc(i);
                if (!standardDoc) {
                    throw new Error(`[parse] 缓存的标准文档 ${i} 不存在`);
                }

                const tree = parseMarkdown(standardDoc);
                const result = tryStandard(tree, ctx);

                if (!result.flow) {
                    throw new Error(
                        `[parse] 缓存的标准文档 ${i} 解析失败：\n${result.errors.join("\n")}`
                    );
                }

                // 验证
                const validationErrors = validateHumanFlow(result.flow, ctx.conceptManager);
                if (validationErrors.length > 0) {
                    throw new Error(
                        `[parse] 文档 ${i} 验证失败：\n${errorsToString(validationErrors)}`
                    );
                }

                // 注册到 ConceptManager
                registerFlow(ctx, result.flow, i);
            }

            ctx.ctx.notify("parse 完成", `共 ${cachedIndex.length} 个工作流（从缓存）`);
            return;
        }
    }

    // 门控未过 → 解析原始文档
    ctx.ctx.notify("parse", `开始解析 ${docs.length} 个原始文档`);

    const docIds: string[] = [];

    for (let i = 0; i < docs.length; i++) {
        const doc = docs[i];

        // 尝试解析为标准文档
        const tree = parseMarkdown(doc);
        const result = tryStandard(tree, ctx);

        if (!result.flow) {
            // TODO: 后续引入 LLM 补全分支（当前先报错）
            throw new Error(
                `[parse] 文档 ${i} 不符合标准格式：\n${result.errors.join("\n")}\n\n` +
                `（LLM 补全功能尚未实现）`
            );
        }

        // 验证
        const validationErrors = validateHumanFlow(result.flow, ctx.conceptManager);
        if (validationErrors.length > 0) {
            throw new Error(
                `[parse] 文档 ${i} 验证失败：\n${errorsToString(validationErrors)}`
            );
        }

        // 注册到 ConceptManager
        registerFlow(ctx, result.flow, i);

        // 导出标准格式
        const standardDoc = exportToStandardFormat(result.flow, ctx);

        // 缓存标准文档
        ctx.storage.workflow.saveStandardDoc(i, standardDoc);

        // 记录文档 id
        docIds.push(`doc_${i}`);
    }

    // 保存文档 id 列表（整体门控的输出）
    ctx.storage.workflow.saveParsedDocsIndex(docIds);

    ctx.ctx.notify("parse 完成", `共 ${docs.length} 个工作流`);
}

/** 注册 flow 到 ConceptManager，并标记主入口（index 0） */
function registerFlow(
    ctx: WeaveContext,
    flow: import("../../types.js").HumanFlow,
    index: number
): void {
    ctx.conceptManager.graphs.register(flow);
    if (index === 0) {
        ctx.conceptManager.setEntryGraph(flow.id);
    }
}