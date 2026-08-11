/**
 * weaver · 知识检索门面
 */

import type { WeaveStorage } from '../storage.js';

export interface KBLookupResult<T> {
    item: T;
    score: number;
}

export interface GlobalKB {
    searchTool(query: string, limit: number): Promise<KBLookupResult<{ id: string; name: string; description: string }>[]>;
    registerTool(id: string, name: string, description: string): void;
    searchSkill(query: string, limit: number): Promise<KBLookupResult<{ id: string; signature: string }>[]>;
    registerSkill(id: string, signature: string): void;
    searchConceptDedupe(feature: string): Promise<string | null>;
    /** 注入概念归一缓存（由 ConceptTable.deduplicate 调用） */
    injectConceptDedupeEntry(feature: string, canonicalId: string): void;
}

let _globalKB: GlobalKB | null = null;

export function getGlobalKB(storage: WeaveStorage): GlobalKB {
    if (_globalKB) return _globalKB;
    _globalKB = createInMemoryKB(storage);
    return _globalKB;
}

function createInMemoryKB(storage: WeaveStorage): GlobalKB {
    const toolCache: { id: string; name: string; description: string }[] = [];
    const skillCache: { id: string; signature: string }[] = [];
    const conceptDedupeCache: Map<string, string> = new Map();

    function refreshToolCache(): void {
        toolCache.length = 0;
        for (const id of storage.listToolIds()) {
            const t = storage.getTool(id);
            if (t) toolCache.push({ id, name: t.name, description: t.description });
        }
    }

    function refreshSkillCache(): void {
        skillCache.length = 0;
        for (const id of storage.listSkillIds()) {
            const s = storage.getSkill(id);
            if (s) skillCache.push({ id, signature: s.signature });
        }
    }

    function simpleScore(query: string, target: string): number {
        const q = query.toLowerCase();
        const t = target.toLowerCase();
        if (q === t) return 0;
        if (t.includes(q) || q.includes(t)) return 0.2;
        const qWords = new Set(q.split(/\s+/));
        const tWords = new Set(t.split(/\s+/));
        let inter = 0;
        for (const w of qWords) if (tWords.has(w)) inter++;
        const union = qWords.size + tWords.size - inter;
        return union > 0 ? 1 - inter / union : 1;
    }

    const kb: GlobalKB = {
        async searchTool(query, limit) {
            if (toolCache.length === 0) refreshToolCache();
            const scored = toolCache.map(t => ({
                item: t,
                score: simpleScore(query, `${t.name} ${t.description}`),
            }));
            scored.sort((a, b) => a.score - b.score);
            return scored.slice(0, limit);
        },

        registerTool(id, name, description) {
            storage.saveTool(id, { name, description, keywords: [] });
            refreshToolCache();
        },

        async searchSkill(query, limit) {
            if (skillCache.length === 0) refreshSkillCache();
            const scored = skillCache.map(s => ({
                item: s,
                score: simpleScore(query, s.signature),
            }));
            scored.sort((a, b) => a.score - b.score);
            return scored.slice(0, limit);
        },

        registerSkill(_id, _signature) {
            refreshSkillCache();
        },

        async searchConceptDedupe(feature) {
            let bestId: string | null = null;
            let bestScore = 0.5;
            for (const [key, id] of conceptDedupeCache) {
                const score = simpleScore(feature, key);
                if (score < bestScore) {
                    bestScore = score;
                    bestId = id;
                }
            }
            return bestId;
        },

        injectConceptDedupeEntry(feature, canonicalId) {
            conceptDedupeCache.set(feature, canonicalId);
        },
    };

    return kb;
}

export function injectConceptDedupeEntry(feature: string, canonicalId: string): void {
    if (!_globalKB) return;
    _globalKB.injectConceptDedupeEntry(feature, canonicalId);
}