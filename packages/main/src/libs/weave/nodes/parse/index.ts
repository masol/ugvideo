/**
 * weaver · node ① parse
 *
 * 变更：
 * - index 0 的文档对应图注册时置 isMain=true；
 * - 缓存重建路径回填交付物语义作用（applyArtifactSemantics）。
 *
 * 缓存命中路径：从结构化 JSON 确定性重建 flow + 由代码渲染标准 doc 并回灌缓存。
 */

import { checkExpiry } from "$libs/blueprint/glossary/expiry.js";
import type { WeaveContext } from "../../context.js";
import type { FlowGraph, HumanFlow } from "../../types.js";
import { applyArtifactSemantics, buildHumanFlowFromParsed } from "./build-flow.js";
import type { CachedWorkflow } from "./extract-workflow.js";
import { extractWorkflow } from "./extract-workflow.js";
import { renderStandardDoc } from "./render-standard.js";

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
            const cachedAll: CachedWorkflow[] = [];
            let complete = true;
            for (let i = 0; i < docs.length; i++) {
                const c = ctx.storage.workflow.getExtractedWorkflow(i);
                if (!c) {
                    complete = false;
                    break;
                }
                cachedAll.push(c);
            }

            if (complete) {
                ctx.ctx.notify("parse", `命中缓存，共 ${cachedAll.length} 个文档`);
                for (let i = 0; i < cachedAll.length; i++) {
                    const c = cachedAll[i];
                    const flow = buildHumanFlowFromParsed(
                        c.flowName,
                        c.goal,
                        c.globalInputs,
                        c.nodes,
                        ctx,
                    );
                    registerFlow(ctx, flow, i);
                    applyArtifactSemantics(ctx, c.artifactSemantics ?? []);
                    const standardDoc = renderStandardDoc(
                        c.flowName,
                        c.goal,
                        c.globalInputs,
                        c.nodes,
                    );
                    ctx.storage.workflow.saveStandardDoc(i, standardDoc);
                }
                ctx.ctx.notify("parse 完成", `共 ${cachedAll.length} 个工作流（从缓存）`);
                return;
            }
        }
    }

    ctx.ctx.notify("parse", `开始解析 ${docs.length} 个原始文档`);

    const docIds: string[] = [];

    const goal = ctx.storage.workflow.getGoal();
    const constraints = ctx.storage.workflow.getConstraints();
    const preferences = ctx.storage.workflow.getPreferences();

    for (let i = 0; i < docs.length; i++) {
        const doc = docs[i];
        const { flow, standardDoc, cached } = await extractWorkflow(ctx, doc, i, {
            goal,
            constraints,
            preferences,
        });

        registerFlow(ctx, flow, i);
        ctx.storage.workflow.saveStandardDoc(i, standardDoc);
        ctx.storage.workflow.saveExtractedWorkflow(i, cached);

        docIds.push(`doc_${i}`);
    }

    ctx.storage.workflow.saveParsedDocsIndex(docIds);

    ctx.ctx.notify("parse 完成", `共 ${docs.length} 个工作流`);
}

function registerFlow(ctx: WeaveContext, flow: HumanFlow, index: number): void {
    const pending = (flow as HumanFlow & { _pendingNodes?: import("../../types.js").HumanNode[] })
        ._pendingNodes;
    if (pending) {
        for (const node of pending) {
            ctx.conceptManager.nodes.register(node);
        }
    }
    const { _pendingNodes: _omit, ...rest } = flow as HumanFlow & {
        _pendingNodes?: import("../../types.js").HumanNode[];
    };
    const flowToRegister = rest as HumanFlow;
    if (index === 0) {
        (flowToRegister as FlowGraph).isMain = true;
    }
    ctx.conceptManager.graphs.register(flowToRegister);
    if (index === 0) {
        ctx.conceptManager.setEntryGraph(flowToRegister.id);
    }
}