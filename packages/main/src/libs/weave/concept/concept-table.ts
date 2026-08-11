/**
 * weaver · ConceptTable
 *
 * 纯内存概念表（运行态），不直接存取 KV。
 * 序列化/反序列化由 ConceptStorage 负责。
 */

import type {
    Artifact,
    ConceptReference,
    Constraint,
    Edge,
    FlowGraph,
    FlowNode,
} from '../types.js';

export class ConceptTable {
    private concepts: Map<string, ConceptReference> = new Map();
    private nameIndex: Map<string, string> = new Map();
    private aliasIndex: Map<string, string> = new Map();

    // ────────────────────────────────────────────────────────────────
    // 注册
    // ────────────────────────────────────────────────────────────────

    register(concept: ConceptReference): void {
        if (this.concepts.has(concept.id)) {
            throw new Error(`[ConceptTable] 概念 id 重复：${concept.id}`);
        }
        this.concepts.set(concept.id, concept);

        const lowerName = concept.name.toLowerCase();
        if (!this.nameIndex.has(lowerName)) {
            this.nameIndex.set(lowerName, concept.id);
        }
        for (const alias of concept.aliases) {
            const lowerAlias = alias.toLowerCase();
            if (!this.aliasIndex.has(lowerAlias)) {
                this.aliasIndex.set(lowerAlias, concept.id);
            }
        }
    }

    registerAll(concepts: ConceptReference[]): void {
        for (const c of concepts) this.register(c);
    }

    unregister(id: string): void {
        const c = this.concepts.get(id);
        if (!c) return;
        this.concepts.delete(id);
        this.nameIndex.delete(c.name.toLowerCase());
        for (const alias of c.aliases) {
            this.aliasIndex.delete(alias.toLowerCase());
        }
    }

    // ────────────────────────────────────────────────────────────────
    // 查询
    // ────────────────────────────────────────────────────────────────

    get(id: string): ConceptReference | null {
        return this.concepts.get(id) ?? null;
    }

    getMany(ids: string[]): ConceptReference[] {
        const out: ConceptReference[] = [];
        for (const id of ids) {
            const c = this.concepts.get(id);
            if (c) out.push(c);
        }
        return out;
    }

    getByName(name: string): ConceptReference | null {
        const id = this.nameIndex.get(name.toLowerCase());
        return id ? this.concepts.get(id) ?? null : null;
    }

    getByAlias(alias: string): ConceptReference | null {
        const id = this.aliasIndex.get(alias.toLowerCase());
        return id ? this.concepts.get(id) ?? null : null;
    }

    list<K extends ConceptReference['kind']>(
        kind?: K,
    ): Extract<ConceptReference, { kind: K }>[] {
        const out: ConceptReference[] = [];
        for (const c of this.concepts.values()) {
            if (!kind || c.kind === kind) out.push(c);
        }
        return out as Extract<ConceptReference, { kind: K }>[];
    }

    listArtifacts(): Artifact[] { return this.list('artifact'); }
    listFlowNodes(): FlowNode[] { return this.list('flow-node') as FlowNode[]; }
    listConstraints(): Constraint[] { return this.list('constraint') as Constraint[]; }
    listEdges(): Edge[] { return this.list('edge'); }
    listFlowGraphs(): FlowGraph[] { return this.list('dag') as FlowGraph[]; }

    count(): number { return this.concepts.size; }

    // ────────────────────────────────────────────────────────────────
    // 约束查询
    // ────────────────────────────────────────────────────────────────

    getValidators(conceptId: string): Constraint[] {
        const c = this.concepts.get(conceptId);
        if (!c) return [];
        return c.validatorIds
            .map(vid => this.concepts.get(vid))
            .filter((v): v is Constraint => v !== null && v?.kind === 'constraint');
    }

    // ────────────────────────────────────────────────────────────────
    // 反查
    // ────────────────────────────────────────────────────────────────

    getGraphsContaining(nodeId: string): FlowGraph[] {
        const graphs = this.listFlowGraphs();
        return graphs.filter(g => g.g.hasNode(nodeId));
    }

    // ────────────────────────────────────────────────────────────────
    // 序列化
    // ────────────────────────────────────────────────────────────────

    toJSON(): ConceptReference[] {
        return [...this.concepts.values()];
    }

    loadFromJSON(concepts: ConceptReference[]): void {
        this.concepts.clear();
        this.nameIndex.clear();
        this.aliasIndex.clear();
        for (const c of concepts) this.register(c);
    }

    clear(): void {
        this.concepts.clear();
        this.nameIndex.clear();
        this.aliasIndex.clear();
    }
}

/** 边的精简视图（用于跨图引用追踪） */
export interface ExternalEdgeLite {
    kind: 'internal' | 'external';
    condition: string | null;
    target?: string;
    targetGraphId?: string;
    targetNodeId?: string;
    returnAfter?: boolean;
}