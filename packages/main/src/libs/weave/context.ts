/**
 * weaver · 全局上下文（DI 容器）
 */

import { PrjDB } from '$libs/project/controllers/drizzle/index.js';
import type { IRunnerContext } from '$types/blueprint/context.js';
import { CompiledProducts } from './concept/compiled-products.js';
import { ConceptTable } from './concept/concept-table.js';
import { createGlobalKB, type GlobalKB } from './concept/kb.js';
import { WeaveStorage } from './storage/index.js';
import type { WeaveConfig } from './types.js';

export class WeaveContext {
    readonly storage: WeaveStorage;
    readonly prjdb: PrjDB;
    readonly conceptTable: ConceptTable;
    readonly compiled: CompiledProducts;
    readonly kb: GlobalKB;
    readonly config: WeaveConfig;
    readonly inputDocs: string[];

    constructor(readonly ctx: IRunnerContext) {
        this.storage = new WeaveStorage(ctx);
        this.prjdb = PrjDB.ensure(ctx.prj);
        this.conceptTable = new ConceptTable();
        this.compiled = new CompiledProducts();
        this.kb = createGlobalKB(this.storage.decision);
        this.config = this.storage.getConfig();
        this.inputDocs = this.storage.getInputDocs();
    }

    get globalGoal(): string {
        return this.inputDocs.join('\n\n---\n\n');
    }

    get conceptCount(): number {
        return this.conceptTable.count();
    }

    notify(title: string, body: string): void {
        this.ctx.notify(title, body);
    }

    warn(msg: string): void { this.ctx.warn(msg); }
    debug(msg: string): void { this.ctx.debug(msg); }
}

export function createWeaveContext(ctx: IRunnerContext): WeaveContext {
    return new WeaveContext(ctx);
}