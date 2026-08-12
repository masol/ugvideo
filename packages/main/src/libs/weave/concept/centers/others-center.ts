/**
 * weaver · OthersCenter
 *
 * 管理 Constraint / Edge / FlowNode（非主流程节点的其他可执行概念）。
 *
 * 注：HumanNode 由 FlowCenter 管理；FlowNode（机器执行节点）在此管理。
 */

import type { WeaveContext } from "../../context.js";
import type {
    ConceptReference,
    Constraint,
    Edge,
    FlowNode,
} from "../../types.js";

export class OthersCenter {
    private constraints: Map<string, Constraint> = new Map();
    private edges: Map<string, Edge> = new Map();
    private flowNodes: Map<string, FlowNode> = new Map();
    private nameIndex: Map<string, string> = new Map();
    private aliasIndex: Map<string, string> = new Map();

    constructor(private readonly wctx: WeaveContext) { }

    // ────────────────────────────────────────────────────────────────
    // 注册
    // ────────────────────────────────────────────────────────────────

    registerConstraint(c: Constraint): void {
        if (this.constraints.has(c.id)) throw new Error(`[OthersCenter] constraint id 重复：${c.id}`);
        this.constraints.set(c.id, c);
        this.indexName(c.id, c.name, c.aliases);
    }

    registerEdge(e: Edge): void {
        if (this.edges.has(e.id)) throw new Error(`[OthersCenter] edge id 重复：${e.id}`);
        this.edges.set(e.id, e);
        this.indexName(e.id, e.name, e.aliases);
    }

    registerFlowNode(n: FlowNode): void {
        if (this.flowNodes.has(n.id)) throw new Error(`[OthersCenter] flowNode id 重复：${n.id}`);
        this.flowNodes.set(n.id, n);
        this.indexName(n.id, n.name, n.aliases);
    }

    private indexName(id: string, name: string, aliases: string[]): void {
        const lower = name.toLowerCase();
        if (!this.nameIndex.has(lower)) this.nameIndex.set(lower, id);
        for (const alias of aliases) {
            const la = alias.toLowerCase();
            if (!this.aliasIndex.has(la)) this.aliasIndex.set(la, id);
        }
    }

    // ────────────────────────────────────────────────────────────────
    // 单类型查询
    // ────────────────────────────────────────────────────────────────

    getConstraint(id: string): Constraint | null {
        return this.constraints.get(id) ?? null;
    }

    getEdge(id: string): Edge | null {
        return this.edges.get(id) ?? null;
    }

    getFlowNode(id: string): FlowNode | null {
        return this.flowNodes.get(id) ?? null;
    }

    listConstraints(): Constraint[] {
        return [...this.constraints.values()];
    }

    listEdges(): Edge[] {
        return [...this.edges.values()];
    }

    listFlowNodes(): FlowNode[] {
        return [...this.flowNodes.values()];
    }

    // ────────────────────────────────────────────────────────────────
    // 聚合查询（供 ConceptManager 遍历）
    // ────────────────────────────────────────────────────────────────

    get(id: string): ConceptReference | null {
        return (
            this.constraints.get(id) ??
            this.edges.get(id) ??
            this.flowNodes.get(id) ??
            null
        );
    }

    getByName(name: string): ConceptReference | null {
        const id = this.nameIndex.get(name.toLowerCase());
        return id ? this.get(id) : null;
    }

    getByAlias(alias: string): ConceptReference | null {
        const id = this.aliasIndex.get(alias.toLowerCase());
        return id ? this.get(id) : null;
    }

    list(kind?: string): ConceptReference[] {
        const out: ConceptReference[] = [];
        if (!kind || kind === "constraint") out.push(...this.constraints.values());
        if (!kind || kind === "edge") out.push(...this.edges.values());
        if (!kind || kind === "flow-node") out.push(...this.flowNodes.values());
        return out;
    }

    count(): number {
        return this.constraints.size + this.edges.size + this.flowNodes.size;
    }

    clear(): void {
        this.constraints.clear();
        this.edges.clear();
        this.flowNodes.clear();
        this.nameIndex.clear();
        this.aliasIndex.clear();
    }
}