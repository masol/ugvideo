 
import { Hookable, type HookCallback } from 'hookable';
import { AsyncParallelHook, AsyncSeriesHook } from './hookable.js';

/**
 * TaskLife 提供两套 hook：
 * - 兼容 tapable 风格的包装（tap/tapPromise/untap/untapAll）；
 * - 原生 Hookable 实例，供高级用法。
 */
class TaskLife {
    public onRegisterWorkers = new AsyncParallelHook<[unknown]>();
    public transform = new AsyncSeriesHook<[unknown]>();
    public beforeAdd = new AsyncParallelHook<[unknown]>();
    public onStart = new AsyncParallelHook<[unknown]>();
    public onCompleted = new AsyncParallelHook<[unknown]>();
    public onFailed = new AsyncParallelHook<[unknown]>();

    public nativeHooks: Hookable<Record<string, HookCallback>> = new Hookable<Record<string, HookCallback>>();
}

export const taskLife = new TaskLife();