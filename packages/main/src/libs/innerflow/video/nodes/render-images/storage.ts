// nodes/render-images/storage.ts
import { PrjDB } from "$libs/project/controllers/drizzle/index.js";
import type { IRunnerContext } from "$types/blueprint/context.js";
import type { RenderResult } from "./types.js";

const P = "#video:";

export class RenderStorage {
    private prjdb: ReturnType<typeof PrjDB.ensure>;

    constructor(ctx: IRunnerContext) {
        this.prjdb = PrjDB.ensure(ctx.prj);
    }

    private read<T>(key: string): T | null {
        return this.prjdb.get<T>(key) ?? null;
    }

    private write<T>(key: string, value: T): void {
        this.prjdb.set(key, value);
    }

    renderResultKey(id: string): string {
        return `${P}render:result_${id}`;
    }

    getRenderResult(id: string): RenderResult | null {
        return this.read<RenderResult>(this.renderResultKey(id));
    }

    saveRenderResult(result: RenderResult): void {
        this.write(this.renderResultKey(result.id), result);
        const idx = this.renderedIds();
        if (!idx.includes(result.id)) {
            this.write(`${P}render:idx:rendered`, [...idx, result.id]);
        }
    }

    renderedIds(): string[] {
        return this.read<string[]>(`${P}render:idx:rendered`) ?? [];
    }

    overviewKey(): string {
        return `${P}output:render_overview`;
    }

    saveOverview(text: string): void {
        this.write(this.overviewKey(), text);
    }
}