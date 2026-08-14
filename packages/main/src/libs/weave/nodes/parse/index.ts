/**
 * weaver · node ① parse
 *
 * 变更：
 * - 缓存命中分支回灌当前 goal（buildHumanFlowFromParsed 用 goal 作为 flow.intent，
 *   goal 修改后缓存重建必须反映最新值）；
 * - checkExpiry 后的日志措辞修正（空 docs 时不打印"命中缓存"）。
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

    const outputIsFresh = checkExpiry(ctx.ctx, {
        inputKeys: "script",
        outputKeys: outputKey,
    });

    if (outputIsFresh && docs.length > 0) {
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
                // 回灌当前 goal（缓存中的 goal 可能已被用户修改）
                const currentGoal = ctx.storage.workflow.getGoal();
                ctx.ctx.notify("parse", `命中缓存，共 ${cachedAll.length} 个文档`);
                for (let i = 0; i < cachedAll.length; i++) {
                    const c = cachedAll[i];
                    const effectiveGoal = currentGoal ?? c.goal;
                    const flow = buildHumanFlowFromParsed(
                        c.flowName,
                        effectiveGoal,
                        c.globalInputs,
                        c.nodes,
                        ctx,
                    );
                    registerFlow(ctx, flow, i);
                    applyArtifactSemantics(ctx, c.artifactSemantics ?? []);
                    const standardDoc = renderStandardDoc(
                        c.flowName,
                        effectiveGoal,
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

    if (docs.length === 0) {
        ctx.ctx.notify("parse", "无输入文档，跳过");
        return;
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