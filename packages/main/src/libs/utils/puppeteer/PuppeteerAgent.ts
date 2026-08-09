/* eslint-disable @typescript-eslint/no-explicit-any */
import { appLife } from '$libs/utils/tapable/applife.js';
import { BrowserWindow, session, shell, type WebContents } from 'electron';
import log from 'electron-log/main.js';
import { EventEmitter } from 'events';
import type { AgentWindowOptions } from './types.js';

// 存储所有 agent 窗口 ID，用于外部判断
const agentWindowIds = new Set<number>();

export function isAgentWindow(win: BrowserWindow): boolean {
    return agentWindowIds.has(win.id);
}

export class PuppeteerAgent extends EventEmitter {
    private win: BrowserWindow | null = null;
    private wc: WebContents | null = null;
    private isVisible = false;

    constructor() {
        super();
    }

    async init(options: AgentWindowOptions = {}): Promise<void> {
        if (this.win) return;

        const width = options.width ?? 1280;
        const height = options.height ?? 800;
        const partition = options.partition ?? 'persist:agent';
        const preloadScript = options.preloadScript ?? '';

        const ses = session.fromPartition(partition);
        ses.setPermissionRequestHandler((webContents, permission, callback) => {
            log.info(`[Agent] 权限请求: ${permission} => 允许`);
            callback(true);
        });

        this.win = new BrowserWindow({
            width,
            height,
            show: false,
            webPreferences: {
                session: ses,
                preload: preloadScript || undefined,
                nodeIntegration: false,
                contextIsolation: true,
            },
        });

        // 标记为 agent 窗口（创建后立即标记）
        agentWindowIds.add(this.win.id);

        this.wc = this.win.webContents;
        this.wc.on('destroyed', () => {
            agentWindowIds.delete(this.win?.id ?? -1);
        });

        // 附加调试器，后续通过 sendCommand 操控
        if (!this.wc.debugger.isAttached()) {
            this.wc.debugger.attach();
        }

        // 清除安全限制
        this.relaxSecurity(this.wc);

        // 初始加载空白页
        await this.goto('about:blank');

        // 注册退出清理
        appLife.beforeQuit.tapPromise('PuppeteerAgent', async () => {
            await this.destroy();
        });

        log.info('[PuppeteerAgent] 初始化完成（原生 CDP 模式）');
    }

    private relaxSecurity(wc: WebContents): void {
        wc.removeAllListeners('will-navigate');
        wc.setWindowOpenHandler(({ url }) => {
            shell.openExternal(url).catch(log.error);
            return { action: 'deny' };
        });
    }

    show(): void {
        if (!this.win) throw new Error('Agent 未初始化');
        this.win.show();
        this.isVisible = true;
        this.emit('visibility-changed', true);
    }

    hide(): void {
        if (!this.win) throw new Error('Agent 未初始化');
        this.win.hide();
        this.isVisible = false;
        this.emit('visibility-changed', false);
    }

    async goto(
        url: string,
        options?: { waitUntil?: 'load' | 'domcontentloaded' | 'networkidle0' | 'networkidle2' }
    ): Promise<void> {
        if (!this.wc) throw new Error('WebContents 未初始化');
        // 使用 CDP Page.navigate 替代 puppeteer 的 goto
        const result = await this.wc.debugger.sendCommand('Page.navigate', { url });
        if (result.errorText) throw new Error(result.errorText);
        // 等待指定加载状态
        await this.waitForLoad(options?.waitUntil ?? 'load');
    }

    private async waitForLoad(state: string): Promise<void> {
        if (!this.wc) return;
        if (state === 'load') {
            await new Promise<void>((resolve) => {
                if (!this.wc?.isLoading()) resolve();
                else this.wc?.once('did-finish-load', resolve);
            });
        } else if (state === 'domcontentloaded') {
            await new Promise<void>((resolve) => {
                if (!this.wc?.isLoadingMainFrame()) resolve();
                else this.wc?.once('dom-ready', resolve);
            });
        } else if (state === 'networkidle0' || state === 'networkidle2') {
            // 简化实现：等待至少 500ms 无新请求
            await new Promise((r) => setTimeout(r, 500));
            // 严格实现需要监听网络请求，这里省略，可后续扩展
        }
    }

    async evaluate<T>(fn: (...args: any[]) => T, ...args: any[]): Promise<T> {
        if (!this.wc) throw new Error('WebContents 未初始化');
        const expression = `(${fn.toString()})(${args.map(a => JSON.stringify(a)).join(',')})`;
        const result = await this.wc.debugger.sendCommand('Runtime.evaluate', {
            expression,
            returnByValue: true,
            awaitPromise: true,
        });
        if (result.exceptionDetails) {
            throw new Error(result.exceptionDetails.text);
        }
        return result.result.value as T;
    }

    async screenshot(): Promise<string> {
        if (!this.wc) throw new Error('WebContents 未初始化');
        const data = await this.wc.debugger.sendCommand('Page.captureScreenshot', {
            format: 'png',
        });
        return `data:image/png;base64,${data.data}`;
    }

    async closePage(): Promise<void> {
        if (!this.wc) return;
        await this.goto('about:blank');
    }

    async destroy(): Promise<void> {
        if (this.wc?.debugger.isAttached()) {
            this.wc.debugger.detach();
        }
        if (this.win && !this.win.isDestroyed()) {
            this.win.destroy();
            this.win = null;
        }
        this.wc = null;
    }

    getPage(): WebContents | null {
        return this.wc;
    }

    getWindow(): BrowserWindow | null {
        return this.win;
    }
}