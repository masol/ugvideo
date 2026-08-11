/**
 * weaver · CompiledProducts
 *
 * 纯内存编译产物（运行态）。
 * ExternalInput 不存储——扫描 DAG 即可构建。
 */

import type { ExternalInput } from '../types.js';

export class CompiledProducts {
    private _externalInputs: Map<string, ExternalInput[]> = new Map();

    setExternalInputs(graphId: string, inputs: ExternalInput[]): void {
        this._externalInputs.set(graphId, inputs);
    }

    getExternalInputs(graphId: string): ExternalInput[] {
        return this._externalInputs.get(graphId) ?? [];
    }

    addExternalInput(graphId: string, input: ExternalInput): void {
        const list = this._externalInputs.get(graphId) ?? [];
        if (!list.some(x => x.artifactId === input.artifactId)) {
            list.push(input);
            this._externalInputs.set(graphId, list);
        }
    }

    listAllExternalInputs(): ExternalInput[] {
        const out: ExternalInput[] = [];
        for (const list of this._externalInputs.values()) out.push(...list);
        return out;
    }

    clear(): void {
        this._externalInputs.clear();
    }
}