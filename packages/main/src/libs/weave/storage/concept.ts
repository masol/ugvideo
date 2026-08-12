/**
 * weaver · Concept Storage
 */

import type { ConceptReference } from '../types.js';
import { BaseStorage } from './base.js';

export class ConceptStorage extends BaseStorage {
    protected NS = '#weave:concept:';

    saveConceptTable(concepts: ConceptReference[]): void {
        this.set('snapshot', concepts);
    }

    getConceptTable(): ConceptReference[] {
        return this.get<ConceptReference[]>('snapshot') ?? [];
    }
}