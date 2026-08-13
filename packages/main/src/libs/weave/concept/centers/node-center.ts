/**
 * weaver · NodeCenter
 *
 * 新增 clearById：供 parse reAct rollback 使用。
 */

import type { WeaveContext } from "../../context.js";
import type { FlowNode, HumanNode } from "../../types.js";

export class NodeCenter {
    private nodes: Map<string, FlowNode> = new Map();
    private nameIndex: Map<string, string> = new Map();
    private aliasIndex: Map<string, string> = new Map();

    constructor(private readonly wctx: WeaveContext) { }

    register(node: FlowNode): void {
        if (this.nodes.has(node.id)) {
            throw new Error(`[NodeCenter] id 重复：${node.id}`);
        }
        this.nodes.set(node.id, node);
        const lower = node.name.toLowerCase();
        if (!this.nameIndex.has(lower)) this.nameIndex.set(lower, node.id);
        for (const alias of node.aliases) {
            const la = alias.toLowerCase();
            if (!this.aliasIndex.has(la)) this.aliasIndex.set(la, node.id);
        }
    }

    get(id: string): FlowNode | null {
        return this.nodes.get(id) ?? null;
    }

    getByName(name: string): FlowNode | null {
        const id = this.nameIndex.get(name.toLowerCase());
        return id ? this.nodes.get(id) ?? null : null;
    }

    getByAlias(alias: string): FlowNode | null {
        const id = this.aliasIndex.get(alias.toLowerCase());
        return id ? this.nodes.get(id) ?? null : null;
    }

    list(): FlowNode[] {
        return [...this.nodes.values()];
    }

    listHumanNodes(): HumanNode[] {
        return this.list().filter((n): n is HumanNode => n.kind === "human");
    }

    count(): number {
        return this.nodes.size;
    }

    /** 按 id 单点清除（供 rollback 用） */
    clearById(id: string): boolean {
        const node = this.nodes.get(id);
        if (!node) return false;
        this.nodes.delete(id);
        const lowerName = node.name.toLowerCase();
        if (this.nameIndex.get(lowerName) === id) this.nameIndex.delete(lowerName);
        for (const alias of node.aliases) {
            const la = alias.toLowerCase();
            if (this.aliasIndex.get(la) === id) this.aliasIndex.delete(la);
        }
        return true;
    }

    clear(): void {
        this.nodes.clear();
        this.nameIndex.clear();
        this.aliasIndex.clear();
    }
}