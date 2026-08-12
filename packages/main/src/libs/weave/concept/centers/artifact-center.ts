/**
 * weaver · ArtifactCenter
 *
 * 管理所有 Artifact 概念。
 */

import type { WeaveContext } from "../../context.js";
import type { Artifact, ConceptReference } from "../../types.js";

export class ArtifactCenter {
    private items: Map<string, Artifact> = new Map();
    private nameIndex: Map<string, string> = new Map();
    private aliasIndex: Map<string, string> = new Map();

    constructor(private readonly wctx: WeaveContext) { }

    register(artifact: Artifact): void {
        if (this.items.has(artifact.id)) {
            throw new Error(`[ArtifactCenter] id 重复：${artifact.id}`);
        }
        this.items.set(artifact.id, artifact);
        const lowerName = artifact.name.toLowerCase();
        if (!this.nameIndex.has(lowerName)) this.nameIndex.set(lowerName, artifact.id);
        for (const alias of artifact.aliases) {
            const lower = alias.toLowerCase();
            if (!this.aliasIndex.has(lower)) this.aliasIndex.set(lower, artifact.id);
        }
    }

    get(id: string): Artifact | null {
        return this.items.get(id) ?? null;
    }

    getByName(name: string): Artifact | null {
        const lower = name.toLowerCase();
        const id = this.nameIndex.get(lower);
        return id ? this.items.get(id) ?? null : null;
    }

    getByAlias(alias: string): Artifact | null {
        const lower = alias.toLowerCase();
        const id = this.aliasIndex.get(lower);
        return id ? this.items.get(id) ?? null : null;
    }

    list(): Artifact[] {
        return [...this.items.values()];
    }

    count(): number {
        return this.items.size;
    }

    clear(): void {
        this.items.clear();
        this.nameIndex.clear();
        this.aliasIndex.clear();
    }

    // 提供给 ConceptManager 聚合查询用
    getByNameLower(lower: string): ConceptReference | null {
        return this.getByName(lower);
    }

    getByAliasLower(lower: string): ConceptReference | null {
        return this.getByAlias(lower);
    }
}