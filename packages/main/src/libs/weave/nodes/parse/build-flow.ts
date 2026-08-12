/**
 * weaver · parse · 组装 HumanFlow
 *
 * 供 standard.ts（标准格式路径）和 extract-nodes.ts（LLM 提取路径）共用。
 */

import type { WeaveContext } from "../../context.js";
import { addEdge, addNode, createGraph } from "../../graph/gdag.js";
import type { Artifact, HumanFlow, HumanNode, Jumper } from "../../types.js";
import type { ParsedGlobalInput, ParsedJumper, ParsedNode } from "./standard.js";

export function buildHumanFlowFromParsed(
    flowName: string,
    goal: string,
    globalInputs: ParsedGlobalInput[],
    nodes: ParsedNode[],
    ctx: WeaveContext,
): HumanFlow {
    const mgr = ctx.conceptManager;
    const g = createGraph();
    const nodeIdByOrder = new Map<number, string>();
    const nodeNameByOrder = new Map<number, string>();

    for (const gi of globalInputs) {
        registerArtifact(ctx, gi.key, `全局输入：${gi.key}`, true);
    }

    for (const node of nodes) {
        const nodeId = node.name;
        nodeIdByOrder.set(node.order, nodeId);
        nodeNameByOrder.set(node.order, node.name);
        addNode(g, nodeId);

        for (const inputName of node.inputs) {
            if (!mgr.artifacts.getByName(inputName)) {
                registerArtifact(ctx, inputName, `${node.name} 的输入`, false);
            }
        }
        for (const outputName of node.outputs) {
            if (!mgr.artifacts.getByName(outputName)) {
                registerArtifact(ctx, outputName, `${node.name} 的输出`, false);
            }
        }
    }

    for (let i = 0; i < nodes.length; i++) {
        const node = nodes[i];
        const fromId = nodeIdByOrder.get(node.order)!;

        if (node.jumpers.length === 0) {
            if (i < nodes.length - 1) {
                const nextId = nodeIdByOrder.get(node.order + 1)!;
                addEdge(g, fromId, nextId);
            }
        } else {
            applyJumpers(g, node, fromId, nodeNameByOrder);
        }
    }

    for (const node of nodes) {
        const nodeId = nodeIdByOrder.get(node.order)!;
        mgr.nodes.register(createHumanNode(node, nodeId));
    }

    const flowInputIds = globalInputs
        .filter((gi) => !gi.hasDefault)
        .map((gi) => gi.key);
    const flowOutputIds = nodes
        .filter((n) => g.outDegree(nodeIdByOrder.get(n.order)!) === 0)
        .flatMap((n) => n.outputs);

    return {
        kind: "dag",
        isHumanWorld: true,
        id: flowName,
        name: flowName,
        aliases: [],
        intent: goal,
        inferred: false,
        constraintIds: [],
        actionAtom: `执行 ${flowName}`,
        inputs: flowInputIds,
        outputs: flowOutputIds,
        g,
        formalDoc: "",
    };
}

function applyJumpers(
    g: ReturnType<typeof createGraph>,
    node: ParsedNode,
    fromId: string,
    nodeNameByOrder: Map<number, string>,
): void {
    for (const jp of node.jumpers) {
        if (jp.kind === "external") continue;
        if (!jp.target) continue;
        const entry = [...nodeNameByOrder.entries()].find(([, n]) => n === jp.target);
        if (!entry) continue;
        const targetId = nodeNameByOrder.get(entry[0]);
        if (targetId) addEdge(g, fromId, targetId);
    }
}

function createHumanNode(node: ParsedNode, nodeId: string): HumanNode {
    const jumpers: Jumper[] = node.jumpers.map((jp: ParsedJumper) => ({
        kind: jp.kind,
        condition: jp.condition,
        target: jp.target,
    }));
    return {
        kind: "human",
        id: nodeId,
        name: node.name,
        aliases: [],
        intent: node.intent,
        inferred: false,
        constraintIds: [],
        actionAtom: node.action,
        inputs: node.inputs,
        outputs: node.outputs,
        jumpers,
    };
}

function registerArtifact(ctx: WeaveContext, name: string, intent: string, inferred: boolean): string {
    const existing = ctx.conceptManager.artifacts.getByName(name);
    if (existing) return existing.id;
    const id = name;
    ctx.conceptManager.artifacts.register({
        kind: "artifact",
        id,
        name,
        aliases: [],
        intent,
        inferred,
        constraintIds: [],
        shape: "scalar",
        semanticFields: [],
    } as Artifact);
    return id;
}