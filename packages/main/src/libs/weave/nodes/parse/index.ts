/**
 * weaver · node ① parse
 *
 * v6 变更：
 *  -接收 FrozenNamesConstraint 作为入参（用于 preprocess 重跑反馈时携带）；
 *  - 缓存命中时不再硬性重建——若检测到 artifact 名与 frozen names 不一致，
 *    主动重跑 parse 以稳定名字；
 *  - 完成后清除 frozen names 缓存（preprocess 会重新设置）。
 */

import { checkExpiry } from "$libs/blueprint/glossary/expiry.js";
import type { WeaveContext } from "../../context.js";
import type { FlowGraph, HumanFlow, HumanNode } from "../../types.js";
import { applyArtifactSemantics, buildHumanFlowFromParsed } from "./build-flow.js";
import type { CachedWorkflow } from "./extract-workflow.js";
import { extractWorkflow } from "./extract-workflow.js";
import type { FrozenNamesConstraint } from "./parse-types.js";
import { renderStandardDoc } from "./render-standard.js";

export interface ParseOptions {
    frozenNames?: FrozenNamesConstraint | null;
    /** 是否强制重跑（即使缓存命中） */
    forceRerun?: boolean;
}

export async function parseWorkflow(
    ctx: WeaveContext,
    options: ParseOptions = {},
): Promise<void> {
    const docs = ctx.inputDocs;
    const outputKey = ctx.storage.workflow.latestKey("parsed_docs_index");

    // 若有 frozen names，强制重跑以应用名字约束
    const outputIsFresh = !options.forceRerun &&
        !options.frozenNames &&
        checkExpiry(ctx.ctx, {
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

    // 清除旧的 frozen names（每次重 parse 都重新冻结）
    ctx.storage.workflow.clearFrozenNames();

    for (let i = 0; i < docs.length; i++) {
        const doc = docs[i];
        const { flow, standardDoc, cached } = await extractWorkflow(ctx, doc, i, {
            goal,
            constraints,
            preferences,
            frozenNames: options.frozenNames ?? null,
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
    const pending = (flow as HumanFlow & { _pendingNodes?: HumanNode[] })
        ._pendingNodes;
    if (pending) {
        for (const node of pending) {
            ctx.conceptManager.nodes.register(node);
        }
    }
    const { _pendingNodes: _omit, ...rest } = flow as HumanFlow & {
        _pendingNodes?: HumanNode[];
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