// prod2adimg/storage.ts
import { getInput } from "$libs/blueprint/glossary/input.js";
import { PrjDB } from "$libs/project/controllers/drizzle/index.js";
import type { IRunnerContext } from "$types/blueprint/context.js";
import { readdir } from "node:fs/promises";
import path from "node:path";
import { isDeepStrictEqual } from "node:util";
import type {
    AdSize,
    AdStyle,
    AudienceScenarioReport,
    ColorScheme,
    FontStyle,
    GlobalAdConfig,
    RenderResult,
} from "./types.js";

const P = "#prod:";

const SIZE_PRESETS: Record<string, { width: number; height: number; ratio_label: string }> = {
    "1200x1200": { width: 1200, height: 1200, ratio_label: "1:1" },
    "1920x800": { width: 1920, height: 800, ratio_label: "12:5" },
    "1080x1920": { width: 1080, height: 1920, ratio_label: "9:16" },
    "800x800": { width: 800, height: 800, ratio_label: "1:1" },
    "1200x628": { width: 1200, height: 628, ratio_label: "1.91:1" },
    "750x1334": { width: 750, height: 1334, ratio_label: "9:16" },
    "1080x1080": { width: 1080, height: 1080, ratio_label: "1:1" },
};

export class Storage {
    private prjdb: ReturnType<typeof PrjDB.ensure>;
    private ctx: IRunnerContext;

    constructor(ctx: IRunnerContext) {
        this.ctx = ctx;
        this.prjdb = PrjDB.ensure(ctx.prj);
    }

    private read<T>(key: string): T | null {
        return this.prjdb.get<T>(key) ?? null;
    }

    /** 幂等写入：归一化后深度比较，相等则不落盘。 */
    private write<T>(key: string, value: T): boolean {
        const normalized = JSON.parse(JSON.stringify(value)) as T;
        const existing = this.prjdb.get<T>(key);
        if (isDeepStrictEqual(existing, normalized)) return false;
        this.prjdb.set(key, normalized);
        return true;
    }

    // ==========================================================
    // 默认配置
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
    // 入口输入
    // ==========================================================
    getProductInput(): string[] {
        return getInput(this.ctx) ?? [];
    }

    /**
     * 产品参考图读取 —— 优先项目托管目录 `product_img/`；不存在或为空时回退 input KV。
     *
     * 关键：路径必须走 ctx.project.getPath("product_img") 解析托管目录，
     * 不能用 ctx.prj.path 手工拼接（那是另一个位置，会读不到图）。
     */
    async getProductImages(): Promise<string[]> {
        const dir = this.ctx.prj.getPath("product_img");
        try {
            const items = await readdir(dir);
            const files = items
                .filter(n => !n.startsWith("."))
                .map(n => path.join(dir, n));
            if (files.length > 0) return files;
        } catch {
            // 目录不存在或不可读 → fallback 到 KV
        }
        return this.read<string[]>("productImages") ?? [];
    }

    // ==========================================================
    // 用户配置字段（产品类目/名称/卖点/促销/使用场合）
    // ==========================================================

    private optionalString(key: string): string | null {
        const v = this.prjdb.get<string>(key);
        return v && v.trim().length > 0 ? v.trim() : null;
    }

    getProductCategory(): string | null { return this.optionalString("product_category"); }
    getProductName(): string | null { return this.optionalString("product_name"); }
    getSellingPoints(): string[] {
        const raw = this.prjdb.get<string>("selling_points");
        if (!raw) return [];
        return raw.split(/[\n;,，；]/).map(s => s.trim()).filter(Boolean);
    }
    getPromoText(): string | null { return this.optionalString("promo_text"); }
    getUsageScene(): string | null { return this.optionalString("usage_scene"); }

    /** 把用户配置折叠成一段 NL（优先级的体现），供下游 LLM 消费 */
    getUserProductContext(): string {
        const lines: string[] = [];
        const cat = this.getProductCategory();
        const name = this.getProductName();
        const sps = this.getSellingPoints();
        const promo = this.getPromoText();
        const usage = this.getUsageScene();
        if (cat) lines.push(`- 类目：${cat}`);
        if (name) lines.push(`- 产品名称（含品牌）：${name}`);
        if (sps.length) lines.push(`- 核心卖点（已确认）：${sps.join(" / ")}`);
        if (usage) lines.push(`- 使用场合（已确认，**最高优先级**）：${usage}`);
        if (promo) lines.push(`- 促销信息（已确认）：${promo}`);
        return lines.length > 0
            ? `## 用户已确认的产品信息（**优先级最高**，必须覆盖原文推断）\n${lines.join("\n")}`
            : "";
    }

    /** 配置类 key 列表，供 gate inputKeys 感知 */
    userConfigKeys(): string[] {
        return ["product_category", "product_name", "selling_points", "promo_text", "usage_scene"];
    }

    // ==========================================================
    // 配置读取（ad style / size 等）
    // ==========================================================
    getAdConfig(): GlobalAdConfig {
        return {
            sizes: this.resolveSizes(),
            ad_style: (this.read<string>("config:ad_style") ?? "lifestyle") as AdStyle,
            color_scheme: (this.read<string>("config:color_scheme") ?? "warm") as ColorScheme,
            font_style: (this.read<string>("config:font_style") ?? "modern_sans") as FontStyle,
            product_name: this.getProductName(),
        };
    }

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
    // Step 1.2 人群场景（NL + 结构化双轨）
    // ==========================================================
    audienceScenariosKey(): string { return `${P}state:audience_scenarios`; }
    getAudienceScenarios(): string | null { return this.read<string>(this.audienceScenariosKey()); }
    saveAudienceScenarios(text: string): void { this.write(this.audienceScenariosKey(), text); }

    audienceReportKey(): string { return `${P}state:audience_report`; }
    getAudienceReport(): AudienceScenarioReport | null {
        return this.read<AudienceScenarioReport>(this.audienceReportKey());
    }
    saveAudienceReport(report: AudienceScenarioReport): void {
        this.write(this.audienceReportKey(), report);
    }

    // ==========================================================
    // Step 2.1 文案
    // ==========================================================
    copywritingKey(): string { return `${P}output:copywriting`; }
    getCopywriting(): string | null { return this.read<string>(this.copywritingKey()); }
    saveCopywriting(text: string): void { this.write(this.copywritingKey(), text); }

    // ==========================================================
    // Step 3 视觉设计（每尺寸×场景一份，已合并背景与布局）
    // ==========================================================
    visualKey(compositeKey: string): string { return `${P}state:visual_${compositeKey}`; }
    getVisual(compositeKey: string): string | null { return this.read<string>(this.visualKey(compositeKey)); }
    saveVisual(compositeKey: string, text: string): void {
        this.write(this.visualKey(compositeKey), text);
        const keys = this.visualCompositeKeys();
        if (!keys.includes(compositeKey)) this.write(`${P}idx:visuals`, [...keys, compositeKey]);
    }
    visualCompositeKeys(): string[] { return this.read<string[]>(`${P}idx:visuals`) ?? []; }

    // ==========================================================
    // Step 4 渲染
    // ==========================================================
    renderPromptKey(taskId: string): string { return `${P}render:prompt_${taskId}`; }
    saveRenderPrompt(taskId: string, prompt: string): void { this.write(this.renderPromptKey(taskId), prompt); }
    getRenderPrompt(taskId: string): string | null { return this.read<string>(this.renderPromptKey(taskId)); }

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
    // Step 5 总览
    // ==========================================================
    overviewKey(): string { return `${P}output:render_overview`; }
    saveOverview(text: string): void { this.write(this.overviewKey(), text); }
    getOverview(): string | null { return this.read<string>(this.overviewKey()); }

    // ==========================================================
    // 渲染任务枚举
    // ==========================================================
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