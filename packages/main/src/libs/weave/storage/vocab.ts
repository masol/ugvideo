/**
 * weaver · Vocabulary Storage
 *
 * 命名空间: #weave:vocab:*
 * 负责：词汇表（formal name → aliases）
 */

import { BaseStorage } from './base.js';

export class VocabStorage extends BaseStorage {
    protected NS = '#weave:vocab:';

    saveVocabEntry(formalName: string, aliases: string[]): void {
        this.write(`term:${formalName}`, aliases);
        this.appendToIndex('idx:formals', formalName);
    }

    getVocabEntry(formalName: string): string[] | null {
        return this.read<string[]>(`term:${formalName}`);
    }

    listVocabFormals(): string[] {
        return this.read<string[]>('idx:formals') ?? [];
    }

    private appendToIndex(idxKey: string, id: string): void {
        const list = this.read<string[]>(idxKey) ?? [];
        if (!list.includes(id)) {
            this.write(idxKey, [...list, id]);
        }
    }
}