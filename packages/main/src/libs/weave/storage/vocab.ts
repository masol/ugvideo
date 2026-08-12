/**
 * weaver · Vocabulary Storage
 */

import { BaseStorage } from './base.js';

export class VocabStorage extends BaseStorage {
    protected NS = '#weave:vocab:';

    saveVocabEntry(formalName: string, aliases: string[]): void {
        this.set(`term:${formalName}`, aliases);
        this.appendToIndex('idx:formals', formalName);
    }

    getVocabEntry(formalName: string): string[] | null {
        return this.get<string[]>(`term:${formalName}`);
    }

    listVocabFormals(): string[] {
        return this.get<string[]>('idx:formals') ?? [];
    }

    private appendToIndex(idxKey: string, id: string): void {
        const list = this.get<string[]>(idxKey) ?? [];
        if (!list.includes(id)) {
            this.set(idxKey, [...list, id]);
        }
    }
}