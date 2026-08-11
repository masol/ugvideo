/**
 * weaver · CompiledProducts
 */

import type { ExternalInput, Inference } from '../types.js';

export class CompiledProducts {
    private _externalInputs: Map<string, ExternalInput[]> = new Map();
    private _inferences: Inference[] = [];

    setExternalInputs(graphId: string, inputs: ExternalInput[]): void {
        this._externalInputs.set(graphId, inputs);
    }

    getExternalInputs(graphId: string): ExternalInput[] {
        return this._externalInputs.get(graphId) ?? [];
    }

    addExternalInput(graphId: string, input: ExternalInput): void {
        const list = this._externalInputs.get(graphId) ?? [];
        if (!list.some(x => x.name === input.name)) {
            list.push(input);
            this._externalInputs.set(graphId, list);
        }
    }

    listAllExternalInputs(): ExternalInput[] {
        const out: ExternalInput[] = [];
        for (const list of this._externalInputs.values()) out.push(...list);
        return out;
    }

    addInference(inference: Inference): void {
        this._inferences.push(inference);
    }

    addInferences(inferences: Inference[]): void {
        for (const inf of inferences) this.addInference(inf);
    }

    getInferences(): Inference[] {
        return [...this._inferences];
    }

    getInferencesForTarget(target: string): Inference[] {
        return this._inferences.filter(i => i.target === target);
    }

    clearInferences(): void {
        this._inferences = [];
    }

    toJSON(): {
        externalInputs: Record<string, ExternalInput[]>;
        inferences: Inference[];
    } {
        const obj: Record<string, ExternalInput[]> = {};
        for (const [k, v] of this._externalInputs) obj[k] = v;
        return { externalInputs: obj, inferences: this._inferences };
    }

    loadFromJSON(data: {
        externalInputs: Record<string, ExternalInput[]>;
        inferences: Inference[];
    }): void {
        this._externalInputs.clear();
        for (const [k, v] of Object.entries(data.externalInputs)) {
            this._externalInputs.set(k, v);
        }
        this._inferences = data.inferences ?? [];
    }

    clear(): void {
        this._externalInputs.clear();
        this._inferences = [];
    }
}