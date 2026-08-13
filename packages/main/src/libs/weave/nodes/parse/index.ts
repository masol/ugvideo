/**
 * weaver · node ① parse（v14）
 *
 * 缓存命中路径改为：从结构化 JSON 确定性重建 flow（不再重跑 LLM）。
 */

import { checkExpiry } from "$libs/blueprint/glossary/expiry.js";
import { throwUnprcessable } from "$libs/utils/err.js";
import type { WeaveContext } from "../../context.js";
import type { ValidationError } from "../../graph/validate.js";
import { errorsToString } from "../../graph/validate.js";
import type { HumanFlow } from "../../types.js";
import { buildHumanFlowFromParsed } from "./build-flow.js";
import { extractWorkflow } from "./extract-workflow.js";

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
            // 先确认所有 doc 的结构化缓存都在，全部命中才走缓存路径
            const cachedAll: import("./extract-workflow.js").CachedWorkflow[] = [];
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

    const crossErrors = collectCrossGraphErrors(ctx);
    if (crossErrors.length > 0) {
        ctx.ctx.notify(
            "parse 跨图校验失败",
            `${crossErrors.length} 个错误，进入带反馈的全批重抽`,
        );

        const errorsByDoc = new Map<number, string[]>();
        for (const err of crossErrors) {
            if (!err.graphId) continue;
            const docIdx = findDocIndexForFlow(ctx, err.graphId);
            if (docIdx === null) continue;
            const arr = errorsByDoc.get(docIdx) ?? [];
            arr.push(err.message);
            errorsByDoc.set(docIdx, arr);
        }

        for (const [docIdx, msgs] of errorsByDoc) {
            void msgs;
            rollbackFlow(ctx, docIdx);
            const { flow, standardDoc, cached } = await extractWorkflow(
                ctx,
                docs[docIdx],
                docIdx,
                { goal, constraints, preferences },
            );
            registerFlow(ctx, flow, docIdx);
            ctx.storage.workflow.saveStandardDoc(docIdx, standardDoc);
            ctx.storage.workflow.saveExtractedWorkflow(docIdx, cached);
        }

        const finalErrors = collectCrossGraphErrors(ctx);
        if (finalErrors.length > 0) {
            throwUnprcessable(
                `[parse] 跨图外部跳转校验经重抽仍未通过：\n${errorsToString(finalErrors)}`,
            );
        }
    }

    ctx.storage.workflow.saveParsedDocsIndex(docIds);

    ctx.ctx.notify("parse 完成", `共 ${docs.length} 个工作流`);
}

function collectCrossGraphErrors(ctx: WeaveContext): ValidationError[] {
    const errors: ValidationError[] = [];
    const registeredGraphIds = new Set(ctx.conceptManager.graphs.list().map((g) => g.id));

    for (const graph of ctx.conceptManager.graphs.listHumanFlows()) {
        const allNodes = ctx.conceptManager.nodes.list();
        const nodeById = new Map(allNodes.map((n) => [n.id, n]));

        graph.g.forEachNode((nodeId) => {
            const node = nodeById.get(nodeId);
            if (!node) return;
            for (const jp of node.jumpers) {
                if (jp.kind === "external" && !registeredGraphIds.has(jp.target)) {
                    errors.push({
                        kind: "missing-target-dag",
                        graphId: graph.id,
                        nodeId: node.id,
                        message:
                            `工作流「${graph.name}」节点「${node.name}」的外部跳转目标图「${jp.target}」` +
                            `未在本批文档中注册（已注册：${[...registeredGraphIds].join("、") || "（无）"}）`,
                        category: "missing-concept",
                    });
                }
            }
        });
    }
    return errors;
}

function findDocIndexForFlow(ctx: WeaveContext, graphId: string): number | null {
    for (let i = 0; i < ctx.inputDocs.length; i++) {
        const std = ctx.storage.workflow.getStandardDoc(i);
        if (!std) continue;
        const firstLine = std.split("\n").find((l) => l.startsWith("# "));
        if (firstLine === `# ${graphId}`) return i;
    }
    return null;
}

function registerFlow(ctx: WeaveContext, flow: HumanFlow, index: number): void {
    const pending = (flow as HumanFlow & { _pendingNodes?: import("../../types.js").HumanNode[] })
        ._pendingNodes;
    if (pending) {
        for (const node of pending) {
            ctx.conceptManager.nodes.register(node);
        }
    }
    const { _pendingNodes: _omit, ...flowToRegister } = flow as HumanFlow & {
        _pendingNodes?: import("../../types.js").HumanNode[];
    };
    ctx.conceptManager.graphs.register(flowToRegister);
    if (index === 0) {
        ctx.conceptManager.setEntryGraph(flowToRegister.id);
    }
}

function rollbackFlow(ctx: WeaveContext, docIndex: number): void {
    const std = ctx.storage.workflow.getStandardDoc(docIndex);
    if (!std) return;
    const firstLine = std.split("\n").find((l) => l.startsWith("# "));
    if (!firstLine) return;
    const graphName = firstLine.replace(/^#\s*/, "").trim();

    const graph = ctx.conceptManager.graphs.getByName(graphName);
    if (!graph) return;

    graph.g.forEachNode((nodeId) => {
        ctx.conceptManager.nodes.clearById(nodeId);
    });
    ctx.conceptManager.graphs.clearById(graph.id);
}