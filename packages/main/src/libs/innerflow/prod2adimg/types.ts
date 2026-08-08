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
    /** 用户选中的尺寸预设列表（解析后） */
    sizes: AdSize[];
    ad_style: AdStyle;
    color_scheme: ColorScheme;
    font_style: FontStyle;
}

/** 单个输出尺寸 */
export interface AdSize {
    /** 用作 KV key 与 task 组装的稳定键，如 "1200x1200" / "custom_1000x500" */
    key: string;
    width: number;
    height: number;
    /** 宽高比语义标签，供布局节点选构图，如 "1:1" / "16:9" / "9:16" */
    ratio_label: string;
}

/** 单个渲染任务描述符 */
export interface AdRenderTask {
    /** ad_<sizeKey>_<style>_<copySetIdx> */
    task_id: string;
    size: AdSize;
    style: AdStyle;
    /** 使用的文案套编号（0-based） */
    copy_set_index: number;
    /** 最终发给图像模型的完整 prompt */
    prompt: string;
    /** 产品参考图相对路径（可空） */
    reference_images: string[];
}

/** 渲染结果 */
export interface RenderResult {
    task_id: string;
    /** 相对 prj.path 的输出路径，如 imgs/ad_xxx.jpg */
    file_path: string;
    size_key: string;
    style: AdStyle;
    seed: number;
    rendered_at: number;
    prompt_used: string;
}