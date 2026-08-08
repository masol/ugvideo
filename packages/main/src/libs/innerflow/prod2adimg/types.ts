// prod2adimg/types.ts

/** 广告风格 */
export type AdStyle =
    | "clean"
    | "lifestyle"
    | "festival"
    | "tech"
    | "natural"
    | "luxury";

/** 主辅色方案 */
export type ColorScheme =
    | "brand"
    | "warm"
    | "cool"
    | "neutral"
    | "high_contrast";

/** 字体风格 */
export type FontStyle =
    | "modern_sans"
    | "bold_serif"
    | "handwritten"
    | "futuristic";

/** 从 config 读出的全局风格配置 */
export interface GlobalAdConfig {
    sizes: AdSize[];
    ad_style: AdStyle;
    color_scheme: ColorScheme;
    font_style: FontStyle;
    /** 用户在 config 中确认的产品名称（含品牌），null 表示未设置 */
    product_name: string | null;
}

/** 单个输出尺寸 */
export interface AdSize {
    key: string;
    width: number;
    height: number;
    ratio_label: string;
}

/** 渲染结果 */
export interface RenderResult {
    task_id: string;
    file_path: string;
    size_key: string;
    style: AdStyle;
    seed: number;
    rendered_at: number;
    prompt_used: string;
    /** 本次渲染使用了多少张产品参考图（0 =纯文生图） */
    product_image_count: number;
}

// ==========================================================
// 结构化人群与场景（identify-audience-scenarios 产出，供下游消费）
// ==========================================================

/** 单个人群画像（自检后落盘） */
export interface AudienceProfile {
    label: string;
    age_range: string;
    gender: "male" | "female" | "mixed";
    spending: "low" | "mid" | "mid_high" | "high";
    region: string;
    pain_point: string;
    derivation: string;
}

/** 单个触发场景（三场彼此正交） */
export interface TriggerScenario {
    idx: number;
    title: string;
    description: string;
    visual_anchors: string;
    emotional_hook: string;
    audience_idx: number;
}

/** 结构化人群与场景报告（latest-wins） */
export interface AudienceScenarioReport {
    audiences: AudienceProfile[];
    scenarios: TriggerScenario[];
}