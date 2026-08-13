/**
 * weaver · parse · 组装 HumanFlow
 *
 * 变更（关键稳定性改进）：
 * - DAG 拓扑补全：拓扑序最末的"汇点节点"自动作为唯一终汇；
 *   任何有输出且未被任何下游消费的节点，自动连边到该汇点；
 *   已有出边的节点不动。语义上相当于"未消费输出挂到总汇"，不假设任何控制流。
 * - 全局输入中带默认值的项注册为 Config（携带 defaultValue），其余为普通 Artifact；
 * - artifact/config 的 intent 默认置为名称本身，真正的语义作用由 applyArtifactSemantics 回填。
 */

import type { WeaveContext } from "../../context.js";
import { addEdge, addNode, createGraph } from "../../graph/gdag.js";
import type { Artifact, Config, HumanFlow, HumanNode } from "../../types.js";
import type { ArtifactSemantic, ParsedGlobalInput, ParsedNode } from "./parse-types.js";

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

    registerConfigs(ctx, globalInputs);

    for (const node of nodes) {
        const nodeId = node.name;
        nodeIdByOrder.set(node.order, nodeId);
        addNode(g, nodeId);

        for (const inputName of node.inputs) {
            ensureArtifact(ctx, inputName);
        }
        for (const outputName of node.outputs) {
            ensureArtifact(ctx, outputName);
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

    // ── 拓扑补全：确定唯一的"汇点节点" ──
    const sink = determineSink(g, nodes, nodeIdByOrder);
    if (sink) {
        for (const node of nodes) {
            const fromId = nodeIdByOrder.get(node.order)!;
            if (fromId === sink) continue;
            if (g.outDegree(fromId) > 0) continue;
            // 未被任何下游消费的节点 → 补边到汇点
            addEdge(g, fromId, sink);
            ctx.ctx.info?.(
                `[buildHumanFlowFromParsed] flow=${flowName} ` +
                `拓扑补全：${fromId} → ${sink}`,
            );
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
        _pendingNodes: nodes.map((node) =>
            buildHumanNodeFromParsed(node, nodeIdByOrder.get(node.order)!),
        ),
        _artifactRegistry: registry,
    } as HumanFlow & {
        _pendingNodes: HumanNode[];
        _artifactRegistry: ArtifactRegistry;
    };
}

/**
 * 选汇点策略（按优先级）：
 *   1. 编号最大的步骤（语义上通常是终汇，符合"按顺序"的自然阅读）；
 *   2. 若多个同号，选出度最小的；
 *   3. 若所有节点都尚未形成候选（理论上不可能），返回 null 不补全。
 *
 * 为什么不选 LLM：纯结构决策，避免概率性反复。
 */
function determineSink(
    g: ReturnType<typeof createGraph>,
    nodes: ParsedNode[],
    nodeIdByOrder: Map<number, string>,
): string | null {
    if (nodes.length === 0) return null;
    const maxOrder = Math.max(...nodes.map((n) => n.order));
    const candidates = nodes
        .filter((n) => n.order === maxOrder)
        .map((n) => nodeIdByOrder.get(n.order)!)
        .filter((id) => g.hasNode(id));
    if (candidates.length === 0) return null;
    candidates.sort((a, b) => g.outDegree(a) - g.outDegree(b));
    return candidates[0];
}

/**
 * 回填交付物语义作用到 intent。
 */
export function applyArtifactSemantics(
    ctx: WeaveContext,
    semantics: ArtifactSemantic[],
): void {
    for (const s of semantics) {
        const a = ctx.conceptManager.artifacts.getByName(s.name);
        if (a && s.role.trim()) a.intent = s.role.trim();
    }
}

function registerConfigs(ctx: WeaveContext, globalInputs: ParsedGlobalInput[]): void {
    for (const gi of globalInputs) {
        if (!gi.hasDefault) continue;
        if (ctx.conceptManager.artifacts.getByName(gi.key)) continue;
        ctx.conceptManager.artifacts.register({
            kind: "artifact",
            id: gi.key,
            name: gi.key,
            aliases: [],
            intent: gi.key,
            inferred: false,
            constraintIds: [],
            shape: "scalar",
            semanticFields: [],
            isConfig: true,
            defaultValue: gi.defaultValue ?? "",
        } as Config);
    }
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

function ensureArtifact(ctx: WeaveContext, name: string): string {
    const existing = ctx.conceptManager.artifacts.getByName(name);
    if (existing) return existing.id;
    const id = name;
    ctx.conceptManager.artifacts.register({
        kind: "artifact",
        id,
        name,
        aliases: [],
        intent: name,
        inferred: true,
        constraintIds: [],
        shape: "scalar",
        semanticFields: [],
    } as Artifact);
    return id;
}

function buildHumanNodeFromParsed(node: ParsedNode, nodeId: string): HumanNode {
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
    };
}