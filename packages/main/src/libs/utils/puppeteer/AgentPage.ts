/* eslint-disable @typescript-eslint/no-explicit-any */
import { BrowserWindow, type WebContents } from 'electron';
import { EventEmitter } from 'events';
import type {
    EvaluateFn,
    GotoOptions,
    ScreenshotOptions,
    ScrollOptions,
    WaitForNetworkIdleOptions,
    WaitForSelectorOptions,
} from './types.js';

/**
 * 窗口宿主。由 PuppeteerAgent 创建并持有，AgentPage 只读引用它。
 * inflight 是窗口级共享的在途请求集合（复用窗口的多个 page 共用同一份）。
 */
export interface PageHost {
    readonly win: BrowserWindow;
    readonly inflight: ReadonlySet<string>;
}

/**
 * Puppeteer 风格的页面控制器，包装一个窗口的 webContents。
 * 本类不持有任何全局/模块级状态 —— 窗口、CDP attach、网络监听、
 * 复用注册表全部由 PuppeteerAgent（Symbol 保护的单例）统一管理。
 */
export class AgentPage extends EventEmitter {
    private readonly win: BrowserWindow;
    private readonly wc: WebContents;
    private readonly inflight: ReadonlySet<string>;
    private closed = false;

    constructor(host: PageHost) {
        super();
        this.win = host.win;
        this.wc = host.win.webContents;
        this.inflight = host.inflight;

        // 窗口被外部销毁（崩溃/用户/agent 退出）时，自我标记关闭并广播，
        // 由 PuppeteerAgent 监听 'closed' 完成引用计数与窗口回收。
        this.wc.once('destroyed', () => this.markClosed());
    }

    // ---------------- 基础设施 ----------------

    private ensureAlive(): void {
        if (this.closed || this.win.isDestroyed()) {
            throw new Error('AgentPage 已关闭');
        }
    }

    private async cdp<T = any>(method: string, params?: object): Promise<T> {
        this.ensureAlive();
        return (await this.wc.debugger.sendCommand(method, params)) as T;
    }

    // ---------------- 导航与加载 ----------------

    async goto(url: string, opts: GotoOptions = {}): Promise<void> {
        this.ensureAlive();
        const waitUntil = opts.waitUntil ?? 'load';
        const timeout = opts.timeout ?? 30000;
        const eventName = waitUntil === 'domcontentloaded' ? 'dom-ready' : 'did-finish-load';

        await new Promise<void>((resolve, reject) => {
            const timer = setTimeout(() => {
                cleanup();
                reject(new Error(`导航超时(${timeout}ms): ${url}`));
            }, timeout);

            const onFail = (
                _e: unknown,
                errorCode: number,
                errorDescription: string,
                _validatedURL: string,
                isMainFrame: boolean
            ) => {
                // 只关心主框架失败；忽略子资源失败与 ERR_ABORTED(-3)（重定向/被替换导航属良性）
                if (!isMainFrame) return;
                if (errorCode === -3) return;
                cleanup();
                reject(new Error(`导航失败(${errorCode}): ${errorDescription}`));
            };

            const onDone = () => {
                cleanup();
                resolve();
            };

            const cleanup = () => {
                clearTimeout(timer);
                this.wc.off(eventName as any, onDone);
                this.wc.off('did-fail-load', onFail as any);
            };

            this.wc.once(eventName as any, onDone);
            this.wc.on('did-fail-load', onFail as any);
            this.win.loadURL(url).catch((e) => {
                cleanup();
                reject(e);
            });
        });
    }

    async waitForNetworkIdle(opts: WaitForNetworkIdleOptions = {}): Promise<void> {
        this.ensureAlive();
        const idleTime = opts.idleTime ?? 500;
        const maxInflight = opts.maxInflight ?? 0;
        const timeout = opts.timeout ?? 30000;

        await new Promise<void>((resolve) => {
            let idleTimer: NodeJS.Timeout | null = null;
            const globalTimeout = setTimeout(() => finish(), timeout);

            const finish = () => {
                clearTimeout(globalTimeout);
                if (idleTimer) clearTimeout(idleTimer);
                clearInterval(poll);
                resolve();
            };

            const check = () => {
                if (this.inflight.size <= maxInflight) {
                    if (!idleTimer) idleTimer = setTimeout(finish, idleTime);
                } else if (idleTimer) {
                    clearTimeout(idleTimer);
                    idleTimer = null;
                }
            };

            const poll = setInterval(check, 100);
            check();
        });
    }

    // ---------------- DOM ----------------

    async waitForSelector(selector: string, opts: WaitForSelectorOptions = {}): Promise<void> {
        this.ensureAlive();
        const timeout = opts.timeout ?? 30000;
        const visible = opts.visible ?? false;

        const found = await this.rawEvaluate<boolean>(
            `new Promise((resolve) => {
                const sel = ${JSON.stringify(selector)};
                const needVisible = ${visible};
                const isOk = (el) => {
                    if (!el) return false;
                    if (!needVisible) return true;
                    const r = el.getBoundingClientRect();
                    return r.width > 0 && r.height > 0;
                };
                const hit = () => isOk(document.querySelector(sel));
                if (hit()) return resolve(true);
                const obs = new MutationObserver(() => {
                    if (hit()) { obs.disconnect(); clearTimeout(t); resolve(true); }
                });
                obs.observe(document.documentElement, { childList: true, subtree: true, attributes: true });
                const t = setTimeout(() => { obs.disconnect(); resolve(false); }, ${timeout});
            })`,
            true
        );

        if (!found) throw new Error(`等待选择器超时(${timeout}ms): ${selector}`);
    }

    async evaluate<T = unknown>(fn: EvaluateFn<T>, ...args: any[]): Promise<T> {
        const argList = args.map((a) => JSON.stringify(a)).join(',');
        const expression = `(${fn.toString()})(${argList})`;
        return this.rawEvaluate<T>(expression, true);
    }

    private async rawEvaluate<T>(expression: string, awaitPromise: boolean): Promise<T> {
        const result = await this.cdp<any>('Runtime.evaluate', {
            expression,
            returnByValue: true,
            awaitPromise,
        });
        if (result.exceptionDetails) {
            const detail =
                result.exceptionDetails.exception?.description ||
                result.exceptionDetails.text ||
                '页面脚本执行异常';
            throw new Error(detail);
        }
        return result.result?.value as T;
    }

    // ---------------- 交互 ----------------

    async click(selector: string): Promise<void> {
        await this.waitForSelector(selector, { visible: true });
        const point = await this.evaluate((sel: string) => {
            const el = document.querySelector(sel) as HTMLElement | null;
            if (!el) return null;
            el.scrollIntoView({ block: 'center', inline: 'center' });
            const r = el.getBoundingClientRect();
            return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
        }, selector);

        if (!point) throw new Error(`未找到可点击元素: ${selector}`);

        const base = { x: point.x, y: point.y, button: 'left' as const };
        await this.cdp('Input.dispatchMouseEvent', { type: 'mouseMoved', ...base });
        await this.cdp('Input.dispatchMouseEvent', { type: 'mousePressed', clickCount: 1, ...base });
        await this.cdp('Input.dispatchMouseEvent', { type: 'mouseReleased', clickCount: 1, ...base });
    }

    async type(selector: string, text: string): Promise<void> {
        await this.waitForSelector(selector, { visible: true });
        await this.evaluate((sel: string) => {
            const el = document.querySelector(sel) as HTMLElement | null;
            if (!el) throw new Error('元素不存在');
            el.focus();
        }, selector);

        await this.cdp('Input.insertText', { text });

        await this.evaluate((sel: string) => {
            const el = document.querySelector(sel) as HTMLInputElement | null;
            if (!el) return;
            el.dispatchEvent(new Event('input', { bubbles: true }));
            el.dispatchEvent(new Event('change', { bubbles: true }));
        }, selector);
    }

    async scrollToBottom(opts: ScrollOptions = {}): Promise<void> {
        const distance = opts.distance ?? 400;
        const interval = opts.interval ?? 200;
        const maxScroll = opts.maxScroll ?? 50000;

        await this.evaluate(
            (dist: number, gap: number, max: number) =>
                new Promise<void>((resolve) => {
                    let total = 0;
                    const timer = setInterval(() => {
                        const before = document.documentElement.scrollHeight;
                        window.scrollBy(0, dist);
                        total += dist;
                        const reachedEnd = window.innerHeight + window.scrollY >= before - 2;
                        if (reachedEnd || total >= max) {
                            clearInterval(timer);
                            resolve();
                        }
                    }, gap);
                }),
            distance,
            interval,
            maxScroll
        );
    }

    // ---------------- 内容提取 ----------------

    async content(): Promise<string> {
        return this.rawEvaluate<string>('document.documentElement.outerHTML', false);
    }

    async bodyContent(): Promise<string> {
        return this.rawEvaluate<string>('document.body ? document.body.innerHTML : ""', false);
    }

    async title(): Promise<string> {
        return this.rawEvaluate<string>('document.title', false);
    }

    url(): string {
        return this.wc.getURL();
    }

    async screenshot(opts: ScreenshotOptions = {}): Promise<string> {
        const format = opts.type ?? 'png';
        const params: any = { format, captureBeyondViewport: opts.fullPage ?? false };
        if (format === 'jpeg' && typeof opts.quality === 'number') params.quality = opts.quality;
        if (opts.fullPage) {
            const metrics = await this.cdp<any>('Page.getLayoutMetrics');
            const { cssContentSize } = metrics;
            if (cssContentSize) {
                params.clip = {
                    x: 0,
                    y: 0,
                    width: cssContentSize.width,
                    height: cssContentSize.height,
                    scale: 1,
                };
            }
        }
        const data = await this.cdp<any>('Page.captureScreenshot', params);
        const mime = format === 'jpeg' ? 'image/jpeg' : 'image/png';
        return `data:${mime};base64,${data.data}`;
    }

    // ---------------- 生命周期 ----------------

    show(): void {
        this.ensureAlive();
        this.win.show();
    }

    hide(): void {
        this.ensureAlive();
        this.win.hide();
    }

    getWindow(): BrowserWindow {
        return this.win;
    }

    getWebContents(): WebContents {
        return this.wc;
    }

    isClosed(): boolean {
        return this.closed;
    }

    private markClosed(): void {
        if (this.closed) return;
        this.closed = true;
        this.emit('closed');
    }

    /**
     * 关闭页面。不直接销毁窗口 —— 只广播 'closed'，
     * 由 PuppeteerAgent 按引用计数决定是否回收物理窗口（修复共享窗口被提前销毁的 bug）。
     */
    close(): void {
        this.markClosed();
    }
}