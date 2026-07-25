/* eslint-disable @typescript-eslint/no-explicit-any */
import type { App } from 'electron';
import { Hookable, type HookCallback } from 'hookable';
import pTimeout from 'p-timeout';
import { TrackableDeferred } from '../promise.js';
import { AsyncParallelHook } from './hookable.js';

/**
 * 应用级生命周期管理。
 *
 * 提供两套 hook 接口：
 * - `beforeQuit`：保留 AsyncParallelHook 风格（tap/tapPromise 接口兼容 tapable，
 *   注册方可使用返回的 unregister 函数做动态注销）。
 * - `hooks`：原生 Hookable 实例，保留给需要 hookable 全功能的高级用法。
 */
class AppLife {
    /**
     * 兼容 tapable 的并行 hook。
     * 注册方可使用 `appLife.beforeQuit.tapPromise('name', fn)` 或 `appLife.beforeQuit.tap(...)`，
     * 同时也可以使用 `appLife.beforeQuit.untap('name')` 或 `appLife.beforeQuit.untapAll()`。
     */
    public beforeQuit = new AsyncParallelHook();

    /**
     * 原生 Hookable 实例，供需要细粒度控制的场景使用。
     */
    public hooks: Hookable<Record<string, HookCallback>> = new Hookable<Record<string, HookCallback>>();

    public bootstrapped: TrackableDeferred<void> = new TrackableDeferred<void>();

    private isCleanedUp = false;
    private static readonly BEFORE_QUIT = 'beforeQuit';

    public init(app: App, timeoutMs: number = 30000): void {
        app.on('before-quit', async (e) => {
            if (this.isCleanedUp) return;
            e.preventDefault();

            try {
                const startTs = Date.now();
                // 通过 AsyncParallelHook 触发所有注册的回调
                await pTimeout(
                    this.beforeQuit.promise(),
                    { milliseconds: timeoutMs, message: '退出清理超时' }
                );
                console.error(`[AppLife] 所有任务按时完成。耗时: ${Date.now() - startTs}ms`);
            } catch (err: any) {
                if (err.name === 'TimeoutError') {
                    console.error(`[AppLife] 退出清理超时`);
                } else {
                    console.error(`[AppLife] 退出钩子错误:`, err);
                }
            } finally {
                this.isCleanedUp = true;
                app.quit();
            }
        });
    }
}

const KEY = Symbol.for('unigen.singleton.applife');

export const appLife: AppLife = ((globalThis as any)[KEY] ??= new AppLife());