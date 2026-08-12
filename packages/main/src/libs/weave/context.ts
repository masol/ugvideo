/**
 * weaver · 全局上下文（DI 容器）
 */

import { PrjDB } from "$libs/project/controllers/drizzle/index.js";
import type { IRunnerContext } from "$types/blueprint/context.js";
import { ConceptManager } from "./concept/concept-manager.js";
import { WeaveStorage } from "./storage/index.js";

export class WeaveContext {
    readonly storage: WeaveStorage;
    readonly prjdb: PrjDB;
    readonly conceptManager: ConceptManager;
    readonly inputDocs: string[];

    constructor(readonly ctx: IRunnerContext) {
        this.storage = new WeaveStorage(ctx);
        this.prjdb = PrjDB.ensure(ctx.prj);
        this.conceptManager = new ConceptManager(this);
        this.inputDocs = this.storage.getInputDocs();
    }

    get globalGoal(): string {
        return this.inputDocs.join("\n\n---\n\n");
    }

    get conceptCount(): number {
        return this.conceptManager.count();
    }

    get entryGraphId(): string | null {
        return this.conceptManager.entryGraphId;
    }
}

export function createWeaveContext(ctx: IRunnerContext): WeaveContext {
    return new WeaveContext(ctx);
}