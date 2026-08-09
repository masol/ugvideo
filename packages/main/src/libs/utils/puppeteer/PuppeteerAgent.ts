/* eslint-disable @typescript-eslint/no-explicit-any */
import { appLife } from '$libs/utils/tapable/applife.js';
import { BrowserWindow, session, shell } from 'electron';
import log from 'electron-log/main.js';
import { AgentPage, type PageHost } from './AgentPage.js';
import type { AgentPageOptions, GotoOptions } from './types.js';

interface ManagedWindow extends PageHost {
    win: BrowserWindow;
    reuseKey: string | null;
    refCount: number;
    inflight: Set<string>;
    onMessage: (e: unknown, method: string, params: any) => void;
    torndown: boolean;
}

/**
 * 浏览器工厂（Symbol 保护的进程内单例）。
 *
 * 所有共享状态都是实例成员，随单例唯一存在 —— 即使模块被重复求值，
 * 只要 index.ts 的 Symbol 保证 puppeteerInst 唯一，状态就唯一。
 *
 * 窗口回收采用引用计数：一个窗口可被多个 AgentPage 复用（同 reuseKey），
 * 只有最后一个 page 关闭时才销毁物理窗口。
 */
export class PuppeteerAgent {
    private readonly agentWindowIds = new Set<number>();
    private readonly reuseWindows = new Map<string, ManagedWindow>();
    private readonly pages = new Set<AgentPage>();
    private defaults: AgentPageOptions = {};
    private registered = false;

    init(defaults: AgentPageOptions = {}): void {
        this.defaults = defaults;
        if (!this.registered) {
            appLife.beforeQuit.tapPromise('PuppeteerAgent', async () => {
                await this.closeAll();
            });
            this.registered = true;
        }
        log.info('[PuppeteerAgent] 就绪（原生 CDP + 引用计数窗口复用）');
    }

    /** 退出模块通过它判断某窗口是否为 agent 工具窗口。状态在本单例内，唯一可靠。 */
    isAgentWindow(win: BrowserWindow): boolean {
        return this.agentWindowIds.has(win.id);
    }

    async newPage(options: AgentPageOptions = {}): Promise<AgentPage> {
        const opts = { ...this.defaults, ...options };
        const reuseKey = opts.reuseKey ?? '__default__';
        const reuseMode = opts.reuse ?? 'auto';

        let managed = reuseMode === 'force' ? undefined : this.getReusable(reuseKey);
        if (!managed) {
            managed = await this.createManagedWindow(opts, reuseMode === 'force' ? null : reuseKey);
        }
        managed.refCount++;

        const page = new AgentPage(managed);
        this.pages.add(page);
        page.once('closed', () => {
            this.pages.delete(page);
            this.releaseWindow(managed!);
        });
        return page;
    }

    private getReusable(key: string): ManagedWindow | undefined {
        const m = this.reuseWindows.get(key);
        if (!m) return undefined;
        if (m.win.isDestroyed() || m.torndown) {
            this.reuseWindows.delete(key);
            return undefined;
        }
        return m;
    }

    private async createManagedWindow(
        opts: AgentPageOptions,
        reuseKey: string | null
    ): Promise<ManagedWindow> {
        const partition =
            opts.partition ??
            `unpersist:agent_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

        const ses = session.fromPartition(partition);
        ses.setPermissionRequestHandler((_wc, permission, callback) => {
            log.info(`[PuppeteerAgent] 权限请求: ${permission} => 拒绝`);
            callback(false);
        });

        const win = new BrowserWindow({
            width: opts.width ?? 1280,
            height: opts.height ?? 800,
            show: opts.show ?? false,
            webPreferences: {
                session: ses,
                preload: opts.preloadScript || undefined,
                nodeIntegration: false,
                contextIsolation: true,
                images: opts.loadImages ?? false,
                backgroundThrottling: false,
            },
        });

        this.agentWindowIds.add(win.id);
        if (opts.userAgent) win.webContents.setUserAgent(opts.userAgent);

        // 禁止页面打开新窗口
        win.webContents.setWindowOpenHandler(({ url }) => {
            log.info(`[PuppeteerAgent] 拦截 window.open: ${url}`);
            shell.openExternal(url).catch(log.error);
            return { action: 'deny' };
        });

        const dbg = win.webContents.debugger;
        if (!dbg.isAttached()) {
            try {
                dbg.attach('1.3');
            } catch (err) {
                this.agentWindowIds.delete(win.id);
                if (!win.isDestroyed()) win.destroy();
                log.error('[PuppeteerAgent] CDP attach 失败:', err);
                throw err;
            }
        }

        // 窗口级网络在途跟踪（复用窗口的多个 page 共享，避免重复监听）
        const inflight = new Set<string>();
        const onMessage = (_e: unknown, method: string, params: any) => {
            if (method === 'Network.requestWillBeSent') inflight.add(params.requestId);
            else if (method === 'Network.loadingFinished' || method === 'Network.loadingFailed')
                inflight.delete(params.requestId);
        };
        dbg.on('message', onMessage);
        dbg.sendCommand('Network.enable').catch((e) =>
            log.warn('[PuppeteerAgent] Network.enable 失败:', e)
        );

        const managed: ManagedWindow = {
            win,
            reuseKey,
            refCount: 0,
            inflight,
            onMessage,
            torndown: false,
        };
        if (reuseKey) this.reuseWindows.set(reuseKey, managed);

        // 外部销毁兜底：清理映射，防止陈旧引用被复用
        win.once('closed', () => this.cleanupMaps(managed));

        return managed;
    }

    private releaseWindow(managed: ManagedWindow): void {
        managed.refCount = Math.max(0, managed.refCount - 1);
        if (managed.refCount === 0) this.teardown(managed);
    }

    private teardown(managed: ManagedWindow): void {
        if (managed.torndown) return;
        managed.torndown = true;
        try {
            const dbg = managed.win.webContents?.debugger;
            if (dbg?.isAttached()) dbg.detach();
        } catch {
            /* detach 在销毁过程中可能抛错，忽略 */
        }
        this.cleanupMaps(managed);
        if (!managed.win.isDestroyed()) managed.win.destroy();
    }

    private cleanupMaps(managed: ManagedWindow): void {
        this.agentWindowIds.delete(managed.win.id);
        if (managed.reuseKey && this.reuseWindows.get(managed.reuseKey) === managed) {
            this.reuseWindows.delete(managed.reuseKey);
        }
        try {
            managed.win.webContents?.debugger?.off('message', managed.onMessage);
        } catch {
            /* ignore */
        }
    }

    // ---------------- 便捷方法 ----------------

    async inSequence<T>(
        urls: string[],
        processor: (page: AgentPage, url: string, index: number) => Promise<T>,
        options: AgentPageOptions = {}
    ): Promise<T[]> {
        const results: T[] = [];
        let page: AgentPage | null = null;
        try {
            page = await this.newPage({ ...options, reuse: 'reuse' });
            for (let i = 0; i < urls.length; i++) {
                await page.goto(urls[i]);
                results.push(await processor(page, urls[i], i));
            }
        } finally {
            page?.close();
        }
        return results;
    }

    async scrape<T>(
        url: string,
        extractor: () => T | Promise<T>,
        options: {
            page?: AgentPageOptions;
            goto?: GotoOptions;
            waitForSelector?: string;
            waitForNetworkIdle?: boolean;
        } = {}
    ): Promise<T> {
        const page = await this.newPage(options.page);
        try {
            await page.goto(url, options.goto);
            if (options.waitForNetworkIdle) await page.waitForNetworkIdle();
            if (options.waitForSelector) await page.waitForSelector(options.waitForSelector);
            return await page.evaluate(extractor);
        } finally {
            page.close();
        }
    }

    async getHtml(
        url: string,
        options: {
            page?: AgentPageOptions;
            goto?: GotoOptions;
            waitForSelector?: string;
            waitForNetworkIdle?: boolean;
        } = {}
    ): Promise<string> {
        const page = await this.newPage(options.page);
        try {
            await page.goto(url, options.goto);
            if (options.waitForNetworkIdle) await page.waitForNetworkIdle();
            if (options.waitForSelector) await page.waitForSelector(options.waitForSelector);
            return await page.content();
        } finally {
            page.close();
        }
    }

    async closeAll(): Promise<void> {
        for (const page of [...this.pages]) page.close();
        this.pages.clear();
        // 兜底销毁任何仍存活的托管窗口
        for (const managed of [...this.reuseWindows.values()]) this.teardown(managed);
        this.reuseWindows.clear();
    }

    get openPageCount(): number {
        return this.pages.size;
    }
}