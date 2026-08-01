// nodes/render-images/storage.ts
import { PrjDB } from "$libs/project/controllers/drizzle/index.js";
import type { IRunnerContext } from "$types/blueprint/context.js";
import type { ImageGenParams, RenderResult } from "./types.js";

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

    /** 配置横纵比（项目级 config，不带 #video 前缀），供交付帧尺寸使用 */
    getConfigAspectRatio(): string {
        return this.read<string>("config:aspectRatio") ?? "9:16";
    }

    // --------------------------------------------------------
    // seed：以渲染任务粒度持久化（不 gate，读不到即生成并落盘）
    // --------------------------------------------------------

    seedKey(id: string): string {
        return `${P}render:seed_${id}`;
    }

    getOrCreateSeed(id: string): number {
        const existing = this.read<number>(this.seedKey(id));
        if (typeof existing === "number") return existing;
        // 32-bit 正整数区间，兼容多数图像模型的 seed 取值
        const seed = Math.floor(Math.random() * 2_147_483_647);
        this.write(this.seedKey(id), seed);
        return seed;
    }

    // --------------------------------------------------------
    // 渲染参数（供后续调用 generateImage 时消费）
    // --------------------------------------------------------

    paramsKey(id: string): string {
        return `${P}render:params_${id}`;
    }

    saveRenderParams(id: string, params: ImageGenParams): void {
        this.write(this.paramsKey(id), params);
    }

    getRenderParams(id: string): ImageGenParams | null {
        return this.read<ImageGenParams>(this.paramsKey(id));
    }

    // --------------------------------------------------------
    // 渲染结果
    // --------------------------------------------------------

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