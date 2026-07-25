/* eslint-disable @typescript-eslint/no-explicit-any */
import type { App } from 'electron';
import pTimeout from 'p-timeout';
import { AsyncParallelHook } from 'tapable';
import { TrackableDeferred } from '../promise.js';

class AppLife {
    public hooks = {
        beforeQuit: new AsyncParallelHook<[]>()
    };

    //指示是否初始化完毕了。
    public bootstrapped: TrackableDeferred<void> = new TrackableDeferred<void>();

    private isCleanedUp = false;

    public init(app: App, timeoutMs: number = 30000): void {
        app.on('before-quit', async (e) => {
            if (this.isCleanedUp) return;
            e.preventDefault();

            try {
                // 用 promise() 之前先打印 taps 信息
                const taps = (this.hooks.beforeQuit as any).taps ?? [];
                console.error('[AppLife] 当前 hooks.beforeQuit taps:', taps.map((t: any) => t.name));
                console.error('[AppLife] 即将调用 hooks.beforeQuit.promise()');

                const startTs = Date.now();
                await pTimeout(
                    this.hooks.beforeQuit.promise(),
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
