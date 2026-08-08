// prod2adimg/storage.ts
import { getInput } from "$libs/blueprint/glossary/input.js";
import { PrjDB } from "$libs/project/controllers/drizzle/index.js";
import type { IRunnerContext } from "$types/blueprint/context.js";
import { isDeepStrictEqual } from "node:util";
import type {
    AdSize,
    AdStyle,
    ColorScheme,
    FontStyle,
    GlobalAdConfig,
    RenderResult
} from "./types.js";

const P = "#prod:";

/** 尺寸预设 → 宽高 */
const SIZE_PRESETS: Record<string, { width: number; height: number; ratio_label: string }> = {
    "1200x1200": { width: 1200, height: 1200, ratio_label: "1:1" },
    "1920x800": { width: 1920, height: 800, ratio_label: "12:5" },
    "1080x1920": { width: 1080, height: 1920, ratio_label: "9:16" },
    "800x800": { width: 800, height: 800, ratio_label: "1:1" },
    "1200x628": { width: 1200, height: 628, ratio_label: "1.91:1" },
    "750x1334": { width: 750, height: 1334, ratio_label: "9:16" },
    "1080x1080": { width: 1080, height: 1080, ratio_label: "1:1" },
};

/**
 * 全工作流唯一 KV 封装。
 * - 节点侧只调语义方法，永远不出现裸 key（gate 入参用本类的 *Key() 方法取得）。
 * - write 幂等：内容深度相等则跳过、不刷时间戳，防止误使下游 checkExpiry 过期。
 */
export class Storage {
    private prjdb: ReturnType<typeof PrjDB.ensure>;
    private ctx: IRunnerContext;

    constructor(ctx: IRunnerContext) {
        this.ctx = ctx;
        this.prjdb = PrjDB.ensure(ctx.prj);
    }

    // ---- 内部通用读写 ----
    private read<T>(key: string): T | null {
        return this.prjdb.get<T>(key) ?? null;
    }

    /** 幂等写入：归一化(JSON往返)后深度比较，相等则不落盘。返回是否实际写入。 */
    private write<T>(key: string, value: T): boolean {
        const normalized = JSON.parse(JSON.stringify(value)) as T;
        const existing = this.prjdb.get<T>(key);
        if (isDeepStrictEqual(existing, normalized)) return false;
        this.prjdb.set(key, normalized);
        return true;
    }

    // ==========================================================
    // 首次运行：落盘默认配置（供下游 checkExpiry 依赖的 config key 存在）
    // ==========================================================
    ensureDefaultConfig(): void {
        const defaults: Record<string, string> = {
            "config:size_preset": "1200x1200",
            "config:ad_style": "lifestyle",
            "config:color_scheme": "warm",
            "config:font_style": "modern_sans",
        };
        for (const [k, v] of Object.entries(defaults)) {
            if (this.prjdb.get<string>(k) == null) this.prjdb.set(k, v);
        }
    }

    // ==========================================================
    // 入口输入（首节点）
    // ==========================================================
    getProductInput(): string[] {
        return getInput(this.ctx) ?? [];
    }

    getProductImages(): string[] {
        return this.read<string[]>("productImages") ?? [];
    }

    // ==========================================================
    // 配置读取
    // ==========================================================
    getAdConfig(): GlobalAdConfig {
        return {
            sizes: this.resolveSizes(),
            ad_style: (this.read<string>("config:ad_style") ?? "lifestyle") as AdStyle,
            color_scheme: (this.read<string>("config:color_scheme") ?? "warm") as ColorScheme,
            font_style: (this.read<string>("config:font_style") ?? "modern_sans") as FontStyle,
        };
    }

    /** 解析 config:size_preset（可逗号分隔多个）为 AdSize[] */
    private resolveSizes(): AdSize[] {
        const raw = this.read<string>("config:size_preset") ?? "1200x1200";
        const tokens = raw.split(/[,，]/).map(s => s.trim()).filter(Boolean);
        const sizes: AdSize[] = [];
        for (const token of tokens) {
            if (token === "custom") {
                const w = parseInt(this.read<string>("config:custom_width") ?? "0", 10);
                const h = parseInt(this.read<string>("config:custom_height") ?? "0", 10);
                if (w > 0 && h > 0) {
                    sizes.push({ key: `custom_${w}x${h}`, width: w, height: h, ratio_label: ratioLabel(w, h) });
                }
                continue;
            }
            const preset = SIZE_PRESETS[token];
            if (preset) {
                sizes.push({ key: token, width: preset.width, height: preset.height, ratio_label: preset.ratio_label });
            }
        }
        return sizes.length > 0
            ? sizes
            : [{ key: "1200x1200", width: 1200, height: 1200, ratio_label: "1:1" }];
    }

    /** config key（供 gate inputKeys 使用；配置变更时下游重算） */
    configKeys(): string[] {
        return [
            "config:size_preset",
            "config:custom_width",
            "config:custom_height",
            "config:ad_style",
            "config:color_scheme",
            "config:font_style",
        ];
    }

    // ==========================================================
    // Step 1.1 产品事实
    // ==========================================================
    productProfileKey(): string { return `${P}state:product_profile`; }
    getProductProfile(): string | null { return this.read<string>(this.productProfileKey()); }
    saveProductProfile(text: string): void { this.write(this.productProfileKey(), text); }

    // ==========================================================
    // Step 1.2 人群场景
    // ==========================================================
    audienceScenariosKey(): string { return `${P}state:audience_scenarios`; }
    getAudienceScenarios(): string | null { return this.read<string>(this.audienceScenariosKey()); }
    saveAudienceScenarios(text: string): void { this.write(this.audienceScenariosKey(), text); }

    // ==========================================================
    // Step 2.1 文案
    // ==========================================================
    copywritingKey(): string { return `${P}output:copywriting`; }
    getCopywriting(): string | null { return this.read<string>(this.copywritingKey()); }
    saveCopywriting(text: string): void { this.write(this.copywritingKey(), text); }

    // ==========================================================
    // Step 3.1 场景设计（多份，按 idx）
    // ==========================================================
    sceneDesignKey(idx: number): string { return `${P}state:scene_design_${idx}`; }
    getSceneDesign(idx: number): string | null { return this.read<string>(this.sceneDesignKey(idx)); }

    saveSceneDesign(idx: number, text: string): void {
        this.write(this.sceneDesignKey(idx), text);
        const ids = this.sceneIndices();
        if (!ids.includes(idx)) this.write(`${P}idx:scenes`, [...ids, idx].sort((a, b) => a - b));
    }

    sceneIndices(): number[] { return this.read<number[]>(`${P}idx:scenes`) ?? []; }

    allSceneDesigns(): string[] {
        return this.sceneIndices()
            .map(i => this.getSceneDesign(i))
            .filter((v): v is string => v != null);
    }

    sceneDesignKeys(): string[] {
        return this.sceneIndices().map(i => this.sceneDesignKey(i));
    }

    // ==========================================================
    // Step 3.2 布局（每尺寸一份）
    // ==========================================================
    layoutKey(sizeKey: string): string { return `${P}state:layout_${sizeKey}`; }
    getLayout(sizeKey: string): string | null { return this.read<string>(this.layoutKey(sizeKey)); }

    saveLayout(sizeKey: string, text: string): void {
        this.write(this.layoutKey(sizeKey), text);
        const keys = this.layoutSizeKeys();
        if (!keys.includes(sizeKey)) this.write(`${P}idx:layouts`, [...keys, sizeKey]);
    }

    layoutSizeKeys(): string[] { return this.read<string[]>(`${P}idx:layouts`) ?? []; }

    // ==========================================================
    // Step 4.1 渲染
    // ==========================================================
    renderPromptKey(taskId: string): string { return `${P}render:prompt_${taskId}`; }
    saveRenderPrompt(taskId: string, prompt: string): void { this.write(this.renderPromptKey(taskId), prompt); }
    getRenderPrompt(taskId: string): string | null { return this.read<string>(this.renderPromptKey(taskId)); }

    /** seed 按任务持久化；删掉即下次重随机 */
    seedKey(taskId: string): string { return `${P}render:seed_${taskId}`; }
    getOrCreateSeed(taskId: string): number {
        const existing = this.read<number>(this.seedKey(taskId));
        if (typeof existing === "number") return existing;
        const seed = Math.floor(Math.random() * 2_147_483_647);
        this.prjdb.set(this.seedKey(taskId), seed);
        return seed;
    }

    renderResultKey(taskId: string): string { return `${P}render:result_${taskId}`; }
    getRenderResult(taskId: string): RenderResult | null { return this.read<RenderResult>(this.renderResultKey(taskId)); }

    saveRenderResult(result: RenderResult): void {
        this.write(this.renderResultKey(result.task_id), result);
        const idx = this.renderedTaskIds();
        if (!idx.includes(result.task_id)) this.write(`${P}idx:rendered`, [...idx, result.task_id]);
    }

    renderedTaskIds(): string[] { return this.read<string[]>(`${P}idx:rendered`) ?? []; }

    // ==========================================================
    // Step 5.1 总览
    // ==========================================================
    overviewKey(): string { return `${P}output:render_overview`; }
    saveOverview(text: string): void { this.write(this.overviewKey(), text); }
    getOverview(): string | null { return this.read<string>(this.overviewKey()); }

    // ==========================================================
    // 渲染任务枚举（供 render 节点组装 task 列表）
    // ==========================================================
    /** 由 (sizes × styles × copySetCount) 生成全部任务的 taskId（不含 prompt，prompt 在节点内组装） */
    enumerateTaskIds(sizes: AdSize[], styles: AdStyle[], copySetCount: number): string[] {
        const ids: string[] = [];
        for (const size of sizes) {
            for (const style of styles) {
                for (let c = 0; c < copySetCount; c++) {
                    ids.push(`ad_${size.key}_${style}_${c}`);
                }
            }
        }
        return ids;
    }
}

function ratioLabel(w: number, h: number): string {
    const g = gcd(w, h);
    return `${w / g}:${h / g}`;
}
function gcd(a: number, b: number): number {
    return b === 0 ? a : gcd(b, a % b);
}