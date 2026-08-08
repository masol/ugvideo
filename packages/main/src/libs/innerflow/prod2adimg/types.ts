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
}

// ==========================================================
// 结构化人群与场景（identify-audience-scenarios 产出，供下游消费）
// ==========================================================

/** 单个人群画像（自检后落盘） */
export interface AudienceProfile {
    /** 一句话身份命名（如"易学从业者·勘测师"） */
    label: string;
    /** 年龄段（如"30-50"） */
    age_range: string;
    /** 性别倾向 */
    gender: "male" | "female" | "mixed";
    /** 消费能力 */
    spending: "low" | "mid" | "mid_high" | "high";
    /** 主要聚集地（用于场景设定） */
    region: string;
    /** 该人群典型痛点（一句话） */
    pain_point: string;
    /** 从产品哪个功能推导而来（一句话溯源） */
    derivation: string;
}

/** 单个触发场景（三场彼此正交） */
export interface TriggerScenario {
    /** 场景序号（0,1,2） */
    idx: number;
    /** 一句话命名（具体到"某人在某瞬间"） */
    title: string;
    /** 场景描述（一段话还原那个真实瞬间——谁、在哪、什么时刻、在做什么） */
    description: string;
    /** 视觉锚点（环境/光线/时间/关键道具） */
    visual_anchors: string;
    /** 情感诉求（用户看到画面心里会冒出的那句话） */
    emotional_hook: string;
    /** 该场景对应人群在 idx 数组里的下标 */
    audience_idx: number;
}

/** 结构化人群与场景报告（latest-wins） */
export interface AudienceScenarioReport {
    audiences: AudienceProfile[];
    scenarios: TriggerScenario[];
}