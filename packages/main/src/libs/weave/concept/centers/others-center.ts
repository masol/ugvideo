/**
 * weaver · OthersCenter
 *
 * 管理 Constraint。
 *
 * 注：FlowNode / HumanNode 由 NodeCenter 管理；FlowGraph 由 GraphCenter 管理。
 * 此处的"Others"仅保留 Constraint。
 */

import type { WeaveContext } from "../../context.js";
import type {
    ConceptReference,
    Constraint,
} from "../../types.js";

export class OthersCenter {
    private constraints: Map<string, Constraint> = new Map();
    private nameIndex: Map<string, string> = new Map();
    private aliasIndex: Map<string, string> = new Map();

    constructor(private readonly wctx: WeaveContext) { }

    registerConstraint(c: Constraint): void {
        if (this.constraints.has(c.id)) throw new Error(`[OthersCenter] constraint id 重复：${c.id}`);
        this.constraints.set(c.id, c);
        this.indexName(c.id, c.name, c.aliases);
    }

    private indexName(id: string, name: string, aliases: string[]): void {
        const lower = name.toLowerCase();
        if (!this.nameIndex.has(lower)) this.nameIndex.set(lower, id);
        for (const alias of aliases) {
            const la = alias.toLowerCase();
            if (!this.aliasIndex.has(la)) this.aliasIndex.set(la, id);
        }
    }

    getConstraint(id: string): Constraint | null {
        return this.constraints.get(id) ?? null;
    }

    listConstraints(): Constraint[] {
        return [...this.constraints.values()];
    }

    get(id: string): ConceptReference | null {
        return this.constraints.get(id) ?? null;
    }

    getByName(name: string): ConceptReference | null {
        const id = this.nameIndex.get(name.toLowerCase());
        return id ? this.get(id) : null;
    }

    getByAlias(alias: string): ConceptReference | null {
        const id = this.aliasIndex.get(alias.toLowerCase());
        return id ? this.get(id) : null;
    }

    list(): ConceptReference[] {
        return [...this.constraints.values()];
    }

    count(): number {
        return this.constraints.size;
    }

    clear(): void {
        this.constraints.clear();
        this.nameIndex.clear();
        this.aliasIndex.clear();
    }
}