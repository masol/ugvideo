// nodes/render-videos/storage.ts
import { PrjDB } from "$libs/project/controllers/drizzle/index.js";
import type { IRunnerContext } from "$types/blueprint/context.js";
import type { VideoGenParams, VideoRenderResult } from "./types.js";

const P = "#video:";

export class VideoRenderStorage {
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

    seedKey(segmentId: string): string {
        return `${P}video:seed_${segmentId}`;
    }

    getOrCreateSeed(segmentId: string): number {
        const existing = this.read<number>(this.seedKey(segmentId));
        if (typeof existing === "number") return existing;
        const seed = Math.floor(Math.random() * 2_147_483_647);
        this.write(this.seedKey(segmentId), seed);
        return seed;
    }

    paramsKey(segmentId: string): string {
        return `${P}video:params_${segmentId}`;
    }

    saveRenderParams(segmentId: string, params: VideoGenParams): void {
        this.write(this.paramsKey(segmentId), params);
    }

    getRenderParams(segmentId: string): VideoGenParams | null {
        return this.read<VideoGenParams>(this.paramsKey(segmentId));
    }

    resultKey(segmentId: string): string {
        return `${P}video:result_${segmentId}`;
    }

    getRenderResult(segmentId: string): VideoRenderResult | null {
        return this.read<VideoRenderResult>(this.resultKey(segmentId));
    }

    saveRenderResult(result: VideoRenderResult): void {
        this.write(this.resultKey(result.segment_id), result);
        const idx = this.renderedIds();
        if (!idx.includes(result.segment_id)) {
            this.write(`${P}video:idx:rendered`, [...idx, result.segment_id]);
        }
    }

    renderedIds(): string[] {
        return this.read<string[]>(`${P}video:idx:rendered`) ?? [];
    }
}