export type WaitUntil = 'load' | 'domcontentloaded';

export interface AgentPageOptions {
    width?: number;
    height?: number;
    partition?: string;
    preloadScript?: string;
    show?: boolean;
    loadImages?: boolean;
    userAgent?: string;
    reuse?: 'auto' | 'force' | 'reuse';
    reuseKey?: string;
}

export interface GotoOptions {
    waitUntil?: WaitUntil;
    timeout?: number;
}

export interface WaitForSelectorOptions {
    timeout?: number;
    visible?: boolean;
}

export interface WaitForNetworkIdleOptions {
    idleTime?: number;
    maxInflight?: number;
    timeout?: number;
}

export interface ScrollOptions {
    distance?: number;
    interval?: number;
    maxScroll?: number;
}

export interface ScreenshotOptions {
    type?: 'png' | 'jpeg';
    quality?: number;
    fullPage?: boolean;
}

/**
 * Readability 提取结果（对应 Mozilla Readability 的 parse() 输出）。
 * 包含清洗后的 HTML、纯文本、以及元数据。
 */
export interface ReadabilityResult {
    /** 文章标题 */
    title: string;
    /** 作者署名（如果能提取到） */
    byline: string;
    /** 文本方向（ltr/rtl） */
    dir: string;
    /** 语言代码 */
    lang: string;
    /** 清洗后的正文 HTML（剔除导航栏/广告/页脚等噪音） */
    content: string;
    /** 纯文本内容（所有标签已去除） */
    textContent: string;
    /** 正文长度（字符数） */
    length: number;
    /** 文章摘要（若能提取） */
    excerpt: string;
    /** 站点名称 */
    siteName: string;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type EvaluateFn<T> = (...args: any[]) => T | Promise<T>;