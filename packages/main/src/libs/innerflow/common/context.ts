/**
 * weaver · 全局上下文（DI 容器）
 */

import { PrjDB } from "$libs/project/controllers/drizzle/index.js";
import type { IRunnerContext } from "$types/blueprint/context.js";
import { ICommonStorage } from "./storage/index.js";

export class CommonContext {
    readonly storage: ICommonStorage;
    readonly prjdb: PrjDB;
    readonly inputDocs: string[];

    constructor(readonly ctx: IRunnerContext) {
        this.storage = new ICommonStorage(ctx);
        this.prjdb = PrjDB.ensure(ctx.prj);
        this.inputDocs = this.storage.getInputDocs();
    }
}

export function createCommonContext(ctx: IRunnerContext): CommonContext {
    return new CommonContext(ctx);
}