/**
 * weaver · 全局上下文
 */

import { PrjDB } from '$libs/project/controllers/drizzle/index.js';
import type { IRunnerContext } from '$types/blueprint/context.js';
import { CompiledProducts } from './concept/compiled-products.js';
import { ConceptTable } from './concept/concept-table.js';
import { getGlobalKB, type GlobalKB } from './concept/kb.js';
import { WeaveStorage } from './storage.js';

export class WeaveContext {
    readonly storage: WeaveStorage;
    readonly prjdb: PrjDB;
    readonly conceptTable: ConceptTable;
    readonly compiled: CompiledProducts;
    readonly kb: GlobalKB;

    currentFlowIds: string[] = [];
    reactRound: number = 0;

    private userInputsCache: string[] | null = null;
    private globalGoalCache: string | null = null;

    constructor(readonly ctx: IRunnerContext) {
        this.storage = new WeaveStorage(ctx);
        this.prjdb = PrjDB.ensure(ctx.prj);
        this.conceptTable = new ConceptTable();
        this.compiled = new CompiledProducts();
        this.kb = getGlobalKB(this.storage);
    }

    get userInputs(): string[] {
        if (this.userInputsCache) return this.userInputsCache;
        const body = (this.ctx.cmd.body ?? '').trim();
        this.userInputsCache = body ? body.split(/^---$/m).map(s => s.trim()).filter(Boolean) : [];
        return this.userInputsCache;
    }

    get globalGoal(): string {
        if (this.globalGoalCache !== null) return this.globalGoalCache;
        this.globalGoalCache = this.userInputs.join('\n\n---\n\n');
        return this.globalGoalCache;
    }

    get conceptCount(): number {
        return this.conceptTable.count();
    }

    notify(title: string, body: string): void {
        this.ctx.notify(title, body);
    }

    warn(msg: string): void {
        this.ctx.warn(msg);
    }

    debug(msg: string): void {
        this.ctx.debug(msg);
    }
}

export function createWeaveContext(ctx: IRunnerContext): WeaveContext {
    return new WeaveContext(ctx);
}