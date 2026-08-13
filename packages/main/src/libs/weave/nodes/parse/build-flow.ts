/**
 * weaver · parse · 组装 HumanFlow
 *
 * 核心改动：
 * - DAG构建从"保底顺序连接"改为"artifact依赖驱动"
 * - 每个artifact明确记录producer（产出节点）和consumers（消费节点）
 * - 只有当某节点的输入artifact确实由上游节点产出时，才建立边
 * - 配置项（带默认值的artifact）= 全局输入，无需特殊处理
 */

import type { WeaveContext } from "../../context.js";
import { addEdge, addNode, createGraph } from "../../graph/gdag.js";
import type { Artifact, HumanFlow, HumanNode, Jumper } from "../../types.js";
import type { ParsedGlobalInput, ParsedJumper, ParsedNode } from "./standard.js";

export interface ArtifactRegistry {
    producer: Map<string, string>;
    consumers: Map<string, Set<string>>;
    all: Set<string>;
    orphans: string[];
    dead: string[];
}

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

    for (const node of nodes) {
        const nodeId = node.name;
        nodeIdByOrder.set(node.order, nodeId);
        nodeNameByOrder.set(node.order, node.name);
        addNode(g, nodeId);

        for (const inputName of node.inputs) {
            ensureArtifact(ctx, inputName, `${node.name} 的输入`);
        }
        for (const outputName of node.outputs) {
            ensureArtifact(ctx, outputName, `${node.name} 的输出`);
        }
    }

    const registry = buildArtifactRegistry(nodes, nodeIdByOrder, globalInputs);

    for (const node of nodes) {
        const fromId = nodeIdByOrder.get(node.order)!;
        for (const inputName of node.inputs) {
            const producerId = registry.producer.get(inputName);
            if (producerId && producerId !== fromId && !g.hasEdge(producerId, fromId)) {
                addEdge(g, producerId, fromId);
            }
        }
    }

    for (const node of nodes) {
        const fromId = nodeIdByOrder.get(node.order)!;
        if (node.jumpers.length > 0) {
            applyJumpers(g, node, fromId, nodeNameByOrder);
        }
    }

    if (registry.orphans.length > 0) {
        ctx.ctx.info?.(
            `[buildHumanFlowFromParsed] flow=${flowName} ` +
            `未产出但被消费的artifact: ${registry.orphans.join(", ")}`,
        );
    }
    if (registry.dead.length > 0) {
        ctx.ctx.info?.(
            `[buildHumanFlowFromParsed] flow=${flowName} ` +
            `产出但未消费的artifact: ${registry.dead.join(", ")}`,
        );
    }

    const flowInputIds: string[] = [];
    for (const name of registry.all) {
        if (registry.producer.has(name)) continue;
        const ai = mgr.artifacts.getByName(name);
        if (ai) flowInputIds.push(name);
    }

    const flowOutputIds: string[] = [];
    for (const name of registry.all) {
        if (registry.consumers.has(name) && registry.consumers.get(name)!.size > 0) continue;
        const ai = mgr.artifacts.getByName(name);
        if (ai) flowOutputIds.push(name);
    }

    ctx.ctx.info?.(
        `[buildHumanFlowFromParsed] flow=${flowName} nodes=${nodes.length} ` +
        `edges=${g.size} artifacts=${registry.all.size} ` +
        `orphans=${registry.orphans.length} dead=${registry.dead.length}`,
    );

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
        _pendingNodes: nodes.map((node) =>
            buildHumanNodeFromParsed(node, nodeIdByOrder.get(node.order)!),
        ),
        _artifactRegistry: registry,
    } as HumanFlow & {
        _pendingNodes: HumanNode[];
        _artifactRegistry: ArtifactRegistry;
    };
}

function buildArtifactRegistry(
    nodes: ParsedNode[],
    nodeIdByOrder: Map<number, string>,
    globalInputs: ParsedGlobalInput[],
): ArtifactRegistry {
    const producer = new Map<string, string>();
    const consumers = new Map<string, Set<string>>();
    const all = new Set<string>();

    for (const gi of globalInputs) {
        all.add(gi.key);
        if (!consumers.has(gi.key)) consumers.set(gi.key, new Set());
    }

    for (const node of nodes) {
        const nodeId = nodeIdByOrder.get(node.order)!;

        for (const inputName of node.inputs) {
            all.add(inputName);
            if (!consumers.has(inputName)) consumers.set(inputName, new Set());
            consumers.get(inputName)!.add(nodeId);
        }

        for (const outputName of node.outputs) {
            all.add(outputName);
            if (!producer.has(outputName)) {
                producer.set(outputName, nodeId);
            }
        }
    }

    const orphans: string[] = [];
    for (const name of all) {
        if (!producer.has(name) && consumers.has(name) && consumers.get(name)!.size > 0) {
            const isGlobalInput = globalInputs.some((gi) => gi.key === name);
            if (!isGlobalInput) {
                orphans.push(name);
            }
        }
    }

    const dead: string[] = [];
    for (const name of all) {
        if (producer.has(name) && (!consumers.has(name) || consumers.get(name)!.size === 0)) {
            dead.push(name);
        }
    }

    return { producer, consumers, all, orphans, dead };
}

function ensureArtifact(
    ctx: WeaveContext,
    name: string,
    intent: string,
): string {
    const existing = ctx.conceptManager.artifacts.getByName(name);
    if (existing) return existing.id;
    const id = name;
    ctx.conceptManager.artifacts.register({
        kind: "artifact",
        id,
        name,
        aliases: [],
        intent,
        inferred: true,
        constraintIds: [],
        shape: "scalar",
        semanticFields: [],
    } as Artifact);
    return id;
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

        let targetId: string | undefined;
        const entry = [...nodeNameByOrder.entries()].find(([, n]) => n === jp.target);
        if (entry) {
            targetId = nodeNameByOrder.get(entry[0]);
        } else {
            const numMatch = jp.target.match(/步骤\s*(\d+)/);
            if (numMatch) targetId = nodeNameByOrder.get(parseInt(numMatch[1], 10));
        }
        if (targetId && targetId !== fromId && !g.hasEdge(fromId, targetId)) {
            addEdge(g, fromId, targetId);
        }
    }
}

function buildHumanNodeFromParsed(node: ParsedNode, nodeId: string): HumanNode {
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