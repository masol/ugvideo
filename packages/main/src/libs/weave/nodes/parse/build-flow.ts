/**
 * weaver · parse · 组装 HumanFlow
 *
 * 变更：
 * - 全局输入中带默认值的项注册为 Config（携带 defaultValue），其余为普通 Artifact；
 * - artifact/config 的 intent 不再写"X 的输入/输出"，默认置为名称本身，
 *   真正的语义作用由 applyArtifactSemantics 回填；
 * - 删除 formalDoc 字段。
 *
 * DAG 的边完全由 artifact 依赖驱动：某节点输入 artifact 若由上游节点产出，则连边。
 * Config（带默认值）= 全局输入，不产出边。
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

    // 先注册配置项（带默认值的全局输入），使后续节点输入引用能命中已有 Config
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
 * 回填交付物语义作用到 intent。
 * 在 build 之后调用（此时 artifact/config 均已注册），直接就地修改概念对象。
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
            intent: gi.key, // 语义作用稍后由 applyArtifactSemantics 回填
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
        intent: name, // 语义作用稍后由 applyArtifactSemantics 回填
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