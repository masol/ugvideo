/**
 * weaver · 决策 KB
 */

import type { WeaveStorage } from '../storage.js';
import type { DecisionDomain, DecisionEntry } from '../types.js';

export interface DecisionKB {
    search(domain: DecisionDomain, feature: string, limit: number): DecisionEntry[];
    insert(entry: DecisionEntry): void;
    markSuperseded(oldId: string, newId: string): void;
    rebind(entryId: string, nodeIds: string[]): void;
    get(id: string): DecisionEntry | null;
    list(domain?: DecisionDomain): DecisionEntry[];
}

export function createDecisionKB(storage: WeaveStorage): DecisionKB {
    return new DefaultDecisionKB(storage);
}

let _global: DecisionKB | null = null;

export function getGlobalDecisionKB(storage: WeaveStorage): DecisionKB {
    if (_global) return _global;
    _global = createDecisionKB(storage);
    return _global;
}

class DefaultDecisionKB implements DecisionKB {
    constructor(private storage: WeaveStorage) { }

    search(domain: DecisionDomain, feature: string, limit: number): DecisionEntry[] {
        const all = this.list(domain);
        const scored = all
            .filter(e => !e.supersededBy)
            .map(e => ({
                entry: e,
                score: computeSimilarity(feature, e.featureText),
            }));
        scored.sort((a, b) => a.score - b.score);
        return scored.slice(0, limit).map(s => s.entry);
    }

    insert(entry: DecisionEntry): void {
        this.storage.saveDecisionEntry(entry);
        this.storage.indexDecisionEntry(entry.id);
    }

    markSuperseded(oldId: string, newId: string): void {
        this.storage.supersedeDecisionEntry(oldId, newId);
    }

    rebind(entryId: string, nodeIds: string[]): void {
        const entry = this.storage.getDecisionEntry(entryId);
        if (entry) {
            const merged = new Set([...entry.boundNodes, ...nodeIds]);
            entry.boundNodes = [...merged];
            entry.updatedAt = Date.now();
            this.storage.saveDecisionEntry(entry);
        }
    }

    get(id: string): DecisionEntry | null {
        return this.storage.getDecisionEntry(id);
    }

    list(domain?: DecisionDomain): DecisionEntry[] {
        return this.storage.listDecisionEntries(domain);
    }
}

function computeSimilarity(a: string, b: string): number {
    const aLower = a.toLowerCase();
    const bLower = b.toLowerCase();
    if (aLower === bLower) return 0;
    const aWords = new Set(aLower.split(/\s+/));
    const bWords = new Set(bLower.split(/\s+/));
    let inter = 0;
    for (const w of aWords) if (bWords.has(w)) inter++;
    const union = aWords.size + bWords.size - inter;
    return union > 0 ? 1 - inter / union : 1;
}