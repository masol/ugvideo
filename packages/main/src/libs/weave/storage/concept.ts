/**
 * weaver · Concept Storage
 */

import type { ConceptReference } from '../types.js';
import { BaseStorage } from './base.js';

export class ConceptStorage extends BaseStorage {
    protected NS = '#weave:concept:';

    saveConceptTable(concepts: ConceptReference[]): void {
        this.write('snapshot', concepts);
    }

    getConceptTable(): ConceptReference[] {
        return this.read<ConceptReference[]>('snapshot') ?? [];
    }
}