/**
 * weaver · ConceptTable —— 全局概念表（唯一真相源）
 *
 * 所有 ConceptReference（Artifact / FlowNode / Constraint / FlowGraph / Edge）在此注册。
 * 提供注册、查询、反查、归一接口。
 *
 * 关键设计：
 * - 所有概念以 Map<id, ConceptReference> 存储
 * - 节点（FlowNode）属于哪些 FlowGraph 不存于节点上，由 getGraphsContaining() 反查
 * - 归一（deduplicate）按 name + intent + constraints 文本特征
 */

import type {
    Artifact,
    ConceptReference,
    Constraint,
    Edge,
    FlowGraph,
    FlowNode
} from '../types.js';

export class ConceptTable {
    private concepts: Map<string, ConceptReference> = new Map();
    /** name -> id 索引（用于按名查询） */
    private nameIndex: Map<string, string> = new Map();
    /** alias -> id 索引（用于别名查询） */
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

    /** 批量注册 */
    registerAll(concepts: ConceptReference[]): void {
        for (const c of concepts) this.register(c);
    }

    /** 注销 */
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

    /** 按 kind 过滤 */
    list<K extends ConceptReference['kind']>(
        kind?: K,
    ): Extract<ConceptReference, { kind: K }>[] {
        const out: ConceptReference[] = [];
        for (const c of this.concepts.values()) {
            if (!kind || c.kind === kind) out.push(c);
        }
        return out as Extract<ConceptReference, { kind: K }>[];
    }

    /** 列出所有 artifact */
    listArtifacts(): Artifact[] {
        return this.list('artifact');
    }

    /** 列出所有 flowNode */
    listFlowNodes(): FlowNode[] {
        return this.list('flow-node') as FlowNode[];
    }

    /** 列出所有 constraint */
    listConstraints(): Constraint[] {
        return this.list('constraint') as Constraint[];
    }

    /** 列出所有 edge */
    listEdges(): Edge[] {
        return this.list('edge') as Edge[];
    }

    /** 列出所有 dag */
    listFlowGraphs(): FlowGraph[] {
        return this.list('dag') as FlowGraph[];
    }

    count(): number {
        return this.concepts.size;
    }

    // ────────────────────────────────────────────────────────────────
    // 约束查询
    // ────────────────────────────────────────────────────────────────

    /** 获取概念的所有约束器 */
    getValidators(conceptId: string): Constraint[] {
        const c = this.concepts.get(conceptId);
        if (!c) return [];
        return c.validatorIds
            .map(vid => this.concepts.get(vid))
            .filter((v): v is Constraint => v !== null && v?.kind === 'constraint');
    }

    // ────────────────────────────────────────────────────────────────
    // 反查：节点属于哪些图
    // ────────────────────────────────────────────────────────────────

    /** 反查某节点属于哪些 FlowGraph */
    getGraphsContaining(nodeId: string): FlowGraph[] {
        const graphs = this.listFlowGraphs();
        return graphs.filter(g => g.g.hasNode(nodeId));
    }

    /** 反查某节点被哪些边引用（作为 target） */
    getEdgesReferencingNode(nodeId: string): { graphId: string; nodeId: string; edge: ExternalEdgeLite }[] {
        const out: { graphId: string; nodeId: string; edge: ExternalEdgeLite }[] = [];
        for (const node of this.listFlowNodes()) {
            for (const edge of node.externalEdges) {
                if (edge.kind === 'internal' && edge.target === nodeId) {
                    out.push({ graphId: 'self', nodeId: node.id, edge });
                }
            }
        }
        return out;
    }

    // ────────────────────────────────────────────────────────────────
    // 归一入口
    // ────────────────────────────────────────────────────────────────

    /**
     * 概念归一：合并同义概念。
     * 判定规则：
     *   1. 同 name → 合并
     *   2. 同 alias → 合并
     *   3. intent + aliases 文本相似 → 合并（由 KB 决策）
     *
     * 返回归一后的概念列表。
     */
    async deduplicate(
        concepts: ConceptReference[],
        kbLookup: (feature: string) => Promise<string | null>,
    ): Promise<ConceptReference[]> {
        const merged = new Map<string, ConceptReference>();

        for (const concept of concepts) {
            // 1. 先查 KB
            const feature = this.dedupFeatureText(concept);
            const canonicalId = await kbLookup(feature);

            if (canonicalId && canonicalId !== concept.id) {
                // KB 说这是某个已知概念的别名 → 合并到那个概念
                const canonical = this.concepts.get(canonicalId);
                if (canonical) {
                    this.mergeInto(canonical, concept);
                    merged.set(canonical.id, canonical);
                    continue;
                }
            }

            // 2. 查 name / alias 索引
            const byName = this.getByName(concept.name);
            if (byName && byName.id !== concept.id) {
                this.mergeInto(byName, concept);
                merged.set(byName.id, byName);
                continue;
            }

            const byAlias = concept.aliases.length > 0
                ? this.getByAlias(concept.aliases[0])
                : null;
            if (byAlias && byAlias.id !== concept.id) {
                this.mergeInto(byAlias, concept);
                merged.set(byAlias.id, byAlias);
                continue;
            }

            // 3. 没有命中 → 注册为新概念
            this.register(concept);
            merged.set(concept.id, concept);
        }

        return [...merged.values()];
    }

    /** 归一特征文本（用于 KB 检索） */
    private dedupFeatureText(c: ConceptReference): string {
        return [
            c.name,
            ...c.aliases,
            c.intent,
            c.kind,
        ].join(' | ');
    }

    /** 把 src 合并进 target */
    private mergeInto(target: ConceptReference, src: ConceptReference): void {
        // 合并 aliases
        for (const alias of src.aliases) {
            if (alias !== target.name && !target.aliases.includes(alias)) {
                target.aliases.push(alias);
            }
        }
        // 合并 validators
        for (const vid of src.validatorIds) {
            if (!target.validatorIds.includes(vid)) {
                target.validatorIds.push(vid);
            }
        }
        // name 取权威高者（暂以已注册者优先）
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