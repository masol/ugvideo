/**
 * weaver · GraphCenter
 *
 * 管理所有 FlowGraph（包括 HumanFlow）。
 */

import { throwUnprcessable } from "$libs/utils/err.js";
import type { WeaveContext } from "../../context.js";
import type { FlowGraph, HumanFlow } from "../../types.js";

export class GraphCenter {
    private graphs: Map<string, FlowGraph> = new Map();
    private nameIndex: Map<string, string> = new Map();
    private aliasIndex: Map<string, string> = new Map();

    private _entryGraphId: string | null = null;

    constructor(private readonly wctx: WeaveContext) { }

    register(graph: FlowGraph): void {
        if (this.graphs.has(graph.id)) {
            throwUnprcessable(`[GraphCenter] id 重复：${graph.id}`);
        }
        this.graphs.set(graph.id, graph);
        const lower = graph.name.toLowerCase();
        if (!this.nameIndex.has(lower)) this.nameIndex.set(lower, graph.id);
        for (const alias of graph.aliases) {
            const la = alias.toLowerCase();
            if (!this.aliasIndex.has(la)) this.aliasIndex.set(la, graph.id);
        }
    }

    get(id: string): FlowGraph | null {
        return this.graphs.get(id) ?? null;
    }

    getByName(name: string): FlowGraph | null {
        const id = this.nameIndex.get(name.toLowerCase());
        return id ? this.graphs.get(id) ?? null : null;
    }

    getByAlias(alias: string): FlowGraph | null {
        const id = this.aliasIndex.get(alias.toLowerCase());
        return id ? this.graphs.get(id) ?? null : null;
    }

    list(): FlowGraph[] {
        return [...this.graphs.values()];
    }

    listHumanFlows(): HumanFlow[] {
        return this.list().filter(
            (g): g is HumanFlow =>
                'isHumanWorld' in g &&
                (g as { isHumanWorld: unknown }).isHumanWorld === true);
    }

    count(): number {
        return this.graphs.size;
    }

    get entryGraphId(): string | null {
        return this._entryGraphId;
    }

    setEntryGraph(graphId: string): void {
        this._entryGraphId = graphId;
    }

    /** 反查：哪些图包含该节点 */
    getGraphsContaining(nodeId: string): FlowGraph[] {
        const out: FlowGraph[] = [];
        for (const graph of this.graphs.values()) {
            if (graph.g.hasNode(nodeId)) out.push(graph);
        }
        return out;
    }

    clear(): void {
        this.graphs.clear();
        this.nameIndex.clear();
        this.aliasIndex.clear();
        this._entryGraphId = null;
    }
}