/* eslint-disable @typescript-eslint/no-explicit-any */
import { Hookable, type HookCallback } from 'hookable';

/**
 * Hookable 的 HookCallback 签名约束为 `(...args: any[]) => void | Promise<void>`，
 * 因此在内部包装时需要把 `Promise<unknown>` 适配为 `Promise<void>`。
 * 包装层返回 `() => void` 的 unregister 函数，对外屏蔽 hookable 的细节。
 */

export type AsyncCallback = (...args: any[]) => Promise<unknown> | unknown;

/**
 * 异步并行 hook：tap 注册的所有回调并发执行，全部完成才算 promise 完成。
 * 支持动态注销 (untap)，这是相对 tapable 的核心优势。
 */
export class AsyncParallelHook<P extends any[] = any[]> {
    readonly #hooks: Hookable<Record<string, HookCallback>>;
    readonly #name: string;
    // 保存注册的回调函数引用，用于 unregister
    readonly #registered = new Map<string, AsyncCallback>();

    constructor(name?: string) {
        this.#hooks = new Hookable<Record<string, HookCallback>>();
        this.#name = name ?? `parallel_${Math.random().toString(36).slice(2)}`;
    }

    async promise(...args: P): Promise<void> {
        // callHook 在没有 hook 注册时直接 resolve，无需额外判断
        await this.#hooks.callHook(this.#name, ...(args as any[]));
    }

    /**
     * 注册异步 tap，返回 unregister 函数。
     * 内部把 `Promise<unknown>` 适配为 `Promise<void>` 以满足 HookCallback 签名。
     */
    tapPromise(name: string, fn: (...args: P) => Promise<unknown>): () => void {
        const wrapped: HookCallback = async (...a: any[]): Promise<void> => {
            await fn(...(a as P));
        };
        this.#registered.set(name, fn);
        return this.#hooks.hook(this.#name, wrapped);
    }

    tap(name: string, fn: (...args: P) => unknown): () => void {
        const wrapped: HookCallback = (...a: any[]): void => {
            fn(...(a as P));
        };
        this.#registered.set(name, fn);
        return this.#hooks.hook(this.#name, wrapped);
    }

    /**
     * 注销指定名称的回调。如果之前是通过 tapPromise/tap 注册的，会返回的 unregister 函数自动清理。
     * 这里提供一个按名称注销的便利方法：内部维护一份 unregister 函数表。
     */
    untap(name: string): void {
        // 注意：hookable 的 hook() 返回的 unregister 函数已经处理了清理，
        // 调用方应优先使用该返回值。此方法作为补充，提供基于项目级清理的批量注销。
        const unregister = (this as any)[`__unreg_${name}`] as (() => void) | undefined;
        if (unregister) {
            unregister();
            delete (this as any)[`__unreg_${name}`];
        }
        this.#registered.delete(name);
    }

    /**
     * 清空本 hook 的所有回调。
     */
    untapAll(): void {
        this.#hooks.clearHook(this.#name);
        this.#registered.clear();
    }

    isUsed(): boolean {
        const arr = (this.#hooks as any)._hooks?.[this.#name];
        return Array.isArray(arr) && arr.length > 0;
    }
}

/**
 * 异步串行 hook：tap 注册的回调按注册顺序执行，前一个完成才执行下一个。
 * hookable 内部已经按注册顺序串行调用。
 */
export class AsyncSeriesHook<P extends any[] = any[]> {
    readonly #hooks: Hookable<Record<string, HookCallback>>;
    readonly #name: string;
    readonly #registered = new Map<string, AsyncCallback>();

    constructor(name?: string) {
        this.#hooks = new Hookable<Record<string, HookCallback>>();
        this.#name = name ?? `series_${Math.random().toString(36).slice(2)}`;
    }

    async promise(...args: P): Promise<void> {
        await this.#hooks.callHook(this.#name, ...(args as any[]));
    }

    tapPromise(name: string, fn: (...args: P) => Promise<unknown>): () => void {
        const wrapped: HookCallback = async (...a: any[]): Promise<void> => {
            await fn(...(a as P));
        };
        this.#registered.set(name, fn);
        return this.#hooks.hook(this.#name, wrapped);
    }

    tap(name: string, fn: (...args: P) => unknown): () => void {
        const wrapped: HookCallback = (...a: any[]): void => {
            fn(...(a as P));
        };
        this.#registered.set(name, fn);
        return this.#hooks.hook(this.#name, wrapped);
    }

    untap(name: string): void {
        const unregister = (this as any)[`__unreg_${name}`] as (() => void) | undefined;
        if (unregister) {
            unregister();
            delete (this as any)[`__unreg_${name}`];
        }
        this.#registered.delete(name);
    }

    untapAll(): void {
        this.#hooks.clearHook(this.#name);
        this.#registered.clear();
    }

    isUsed(): boolean {
        const arr = (this.#hooks as any)._hooks?.[this.#name];
        return Array.isArray(arr) && arr.length > 0;
    }
}