/**
 * weaver · ConceptManager
 *
 * 概念管理中心。由四个子中心组成：
 *   - artifacts: Artifact（数据制品）
 *   - graphs:    FlowGraph（工作流图）
 *   - nodes:     FlowNode（工作流节点）
 *   - others:    Constraint / Edge（其他可执行概念）
 */

import type { WeaveContext } from "../context.js";
import type {
    Artifact,
    ConceptKind,
    ConceptReference,
    Constraint,
    Edge,
    FlowGraph,
    FlowNode,
    HumanFlow
} from "../types.js";
import { ArtifactCenter } from "./centers/artifact-center.js";
import { GraphCenter } from "./centers/graph-center.js";
import { NodeCenter } from "./centers/node-center.js";
import { OthersCenter } from "./centers/others-center.js";

export class ConceptManager {
    readonly artifacts: ArtifactCenter;
    readonly graphs: GraphCenter;
    readonly nodes: NodeCenter;
    readonly others: OthersCenter;

    constructor(private readonly wctx: WeaveContext) {
        this.artifacts = new ArtifactCenter(wctx);
        this.graphs = new GraphCenter(wctx);
        this.nodes = new NodeCenter(wctx);
        this.others = new OthersCenter(wctx);
    }

    // ────────────────────────────────────────────────────────────────
    // 主入口标记
    // ────────────────────────────────────────────────────────────────

    get entryGraphId(): string | null {
        return this.graphs.entryGraphId;
    }

    setEntryGraph(graphId: string): void {
        this.graphs.setEntryGraph(graphId);
    }

    // ────────────────────────────────────────────────────────────────
    // 聚合查询（遍历四个子中心）
    // ────────────────────────────────────────────────────────────────

    get(id: string): ConceptReference | null {
        return (
            this.artifacts.get(id) ??
            this.graphs.get(id) ??
            this.nodes.get(id) ??
            this.others.get(id)
        );
    }

    getMany(ids: string[]): ConceptReference[] {
        const out: ConceptReference[] = [];
        for (const id of ids) {
            const c = this.get(id);
            if (c) out.push(c);
        }
        return out;
    }

    getByName(name: string): ConceptReference | null {
        const lower = name.toLowerCase();
        return (
            this.artifacts.getByName(lower) ??
            this.graphs.getByName(lower) ??
            this.nodes.getByName(lower) ??
            this.others.getByName(lower)
        );
    }

    getByAlias(alias: string): ConceptReference | null {
        const lower = alias.toLowerCase();
        return (
            this.artifacts.getByAlias(lower) ??
            this.graphs.getByAlias(lower) ??
            this.nodes.getByAlias(lower) ??
            this.others.getByAlias(lower)
        );
    }

    list(kind?: ConceptKind): ConceptReference[] {
        const out: ConceptReference[] = [];
        if (!kind || kind === "artifact") out.push(...this.artifacts.list());
        if (!kind || kind === "dag") out.push(...this.graphs.list());
        if (!kind || kind === "flow-node" || kind === "human") {
            out.push(...this.nodes.list());
        }
        if (
            !kind ||
            kind === "constraint" ||
            kind === "edge"
        ) {
            out.push(...this.others.list(kind));
        }
        return out;
    }

    count(): number {
        return (
            this.artifacts.count() +
            this.graphs.count() +
            this.nodes.count() +
            this.others.count()
        );
    }

    // ────────────────────────────────────────────────────────────────
    // 便捷聚合查询
    // ────────────────────────────────────────────────────────────────

    listArtifacts(): Artifact[] {
        return this.artifacts.list();
    }

    listGraphs(): FlowGraph[] {
        return this.graphs.list();
    }

    listHumanFlows(): HumanFlow[] {
        return this.graphs.listHumanFlows();
    }

    listNodes(): FlowNode[] {
        return this.nodes.list();
    }

    listHumanNodes(): import("../types.js").HumanNode[] {
        return this.nodes.listHumanNodes();
    }

    listConstraints(): Constraint[] {
        return this.others.listConstraints();
    }

    listEdges(): Edge[] {
        return this.others.listEdges();
    }

    /** 反查：哪些图包含该节点 */
    getGraphsContaining(nodeId: string): FlowGraph[] {
        return this.graphs.getGraphsContaining(nodeId);
    }

    // ────────────────────────────────────────────────────────────────
    // 清空
    // ────────────────────────────────────────────────────────────────

    clear(): void {
        this.artifacts.clear();
        this.graphs.clear();
        this.nodes.clear();
        this.others.clear();
    }
}