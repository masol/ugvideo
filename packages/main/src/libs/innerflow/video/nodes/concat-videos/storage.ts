// nodes/concat-videos/storage.ts
import { PrjDB } from "$libs/project/controllers/drizzle/index.js";
import type { IRunnerContext } from "$types/blueprint/context.js";
import { isDeepStrictEqual } from "node:util";
import type { ConcatPlan } from "./types.js";

const P = "#video:";

export class ConcatStorage {
    private prjdb: ReturnType<typeof PrjDB.ensure>;

    constructor(ctx: IRunnerContext) {
        this.prjdb = PrjDB.ensure(ctx.prj);
    }

    private read<T>(key: string): T | null {
        return this.prjdb.get<T>(key) ?? null;
    }

    private write<T>(key: string, value: T): void {
        const normalized = JSON.parse(JSON.stringify(value)) as T;
        const existing = this.prjdb.get<T>(key);
        if (isDeepStrictEqual(existing, normalized)) return;
        this.prjdb.set(key, normalized);
    }

    planKey(): string { return `${P}video:concat_plan`; }

    getPlan(): ConcatPlan | null {
        return this.read<ConcatPlan>(this.planKey());
    }

    savePlan(plan: ConcatPlan): void {
        this.write(this.planKey(), plan);
    }
}