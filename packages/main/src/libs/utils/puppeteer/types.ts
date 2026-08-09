export type WaitUntil = 'load' | 'domcontentloaded';

export interface AgentPageOptions {
    width?: number;
    height?: number;
    partition?: string;
    preloadScript?: string;
    show?: boolean;
    loadImages?: boolean;
    userAgent?: string;
    /**
     *复用窗口模式：
     * - 'auto'（默认）：如果同 reuseKey 已存在窗口则复用
     * - 'force'：强制新建独立窗口
     * - 'reuse'：复用现有窗口（同 reuseKey），若不存在则新建
     *
     * 复用窗口的 page共享 session/cookie/UA，适合登录态保持 + 串行流程抓取。
     * 不复用则每个 page 完全独立，适合并发抓取不同站点。
     */
    reuse?: 'auto' | 'force' | 'reuse';
    /**
     * 复用窗口的分组 key。同 key 的 page 共享同一个 BrowserWindow。
     * 默认 '__default__'。只有 reuse !== 'force' 时生效。
     */
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

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type EvaluateFn<T> = (...args: any[]) => T | Promise<T>;