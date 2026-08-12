/**
 * weaver · node ① parse
 */

import { checkExpiry } from "$libs/blueprint/glossary/expiry.js";
import { throwUnprcessable } from "$libs/utils/err.js";
import type { WeaveContext } from "../../context.js";
import { errorsToString, validateHumanFlow } from "../../graph/validate.js";
import { HumanFlow } from "../../types.js";
import { exportToStandardFormat } from "./export-standard.js";
import { extractWorkflow } from "./extract-nodes.js";
import { parseMarkdown, tryStandard } from "./standard.js";

export async function parseWorkflow(ctx: WeaveContext): Promise<void> {
    const docs = ctx.inputDocs;
    const outputKey = ctx.storage.workflow.latestKey("parsed_docs_index");

    const shouldSkip = !checkExpiry(ctx.ctx, {
        inputKeys: "script",
        outputKeys: outputKey,
    });

    if (shouldSkip) {
        const cachedIndex = ctx.storage.workflow.getParsedDocsIndex();
        if (cachedIndex && cachedIndex.length === docs.length) {
            ctx.ctx.notify("parse", `命中缓存，共 ${cachedIndex.length} 个文档`);

            for (let i = 0; i < cachedIndex.length; i++) {
                const standardDoc = ctx.storage.workflow.getStandardDoc(i);
                if (!standardDoc) {
                    throwUnprcessable(`[parse] 缓存的标准文档 ${i} 不存在`);
                }

                const tree = parseMarkdown(standardDoc);
                const result = tryStandard(tree, ctx);

                if (!result.flow) {
                    throwUnprcessable(
                        `[parse] 缓存的标准文档 ${i} 解析失败：\n${result.errors.join("\n")}`
                    );
                }

                const validationErrors = validateHumanFlow(result.flow, ctx.conceptManager);
                if (validationErrors.length > 0) {
                    throwUnprcessable(
                        `[parse] 文档 ${i} 验证失败：\n${errorsToString(validationErrors)}`
                    );
                }

                registerFlow(ctx, result.flow, i);
            }

            ctx.ctx.notify("parse 完成", `共 ${cachedIndex.length} 个工作流（从缓存）`);
            return;
        }
    }

    ctx.ctx.notify("parse", `开始解析 ${docs.length} 个原始文档`);

    const docIds: string[] = [];

    for (let i = 0; i < docs.length; i++) {
        const doc = docs[i];

        const tree = parseMarkdown(doc);
        const result = tryStandard(tree, ctx);

        let flow = result.flow;

        if (!flow) {
            // 标准格式解析未通过，走 LLM 语义提取路径
            ctx.ctx.notify("parse", `文档 ${i} 格式非标准，启动 LLM 语义提取`);
            const extracted = await extractWorkflow(ctx, doc, i);
            flow = extracted.flow;
        }

        const validationErrors = validateHumanFlow(flow, ctx.conceptManager);
        if (validationErrors.length > 0) {
            throw new Error(
                `[parse] 文档 ${i} 验证失败：\n${errorsToString(validationErrors)}`
            );
        }

        registerFlow(ctx, flow, i);

        const standardDoc = exportToStandardFormat(flow, ctx);
        ctx.storage.workflow.saveStandardDoc(i, standardDoc);

        docIds.push(`doc_${i}`);
    }

    ctx.storage.workflow.saveParsedDocsIndex(docIds);

    ctx.ctx.notify("parse 完成", `共 ${docs.length} 个工作流`);
}

function registerFlow(
    ctx: WeaveContext,
    flow: HumanFlow,
    index: number
): void {
    ctx.conceptManager.graphs.register(flow);
    if (index === 0) {
        ctx.conceptManager.setEntryGraph(flow.id);
    }
}