import { api } from '$lib/utils/api';
import type { LogLevel, LogMessage } from 'electron-log';
import { default as log, default as Logger } from 'electron-log/renderer';

const ALL_LEVELS: LogLevel[] = [
    "error",
    "warn",
    "info",
    "verbose",
    "debug",
    "silly",
];


class HookLogStore {
    private abortError = new Error("abort");
    // ── 配置 ──
    readonly #maxBuffer: number
    private controller: AbortController | null = null;

    #stopping = false;

    // ── 私有状态 ──
    // 高频细粒度 mutation（push / shift）→ $state（非 raw）
    #logs = $state<LogMessage[]>([])
    #connected = $state(false) //流是否在消费中
    #paused = $state(false)
    #error = $state<string | null>(null)
    #lastUpdated = $state<number | null>(null)
    keepalive = $state(true);
    // 过滤条件。
    search = $state("");
    activeLevels = $state<Set<LogLevel>>(new Set(ALL_LEVELS));
    activeScope = $state("__all__")
    knownComponents: string[] = $state([]);

    // ── 内部句柄（不响应、不暴露） ──
    #stream: AsyncGenerator<LogMessage> | null = null
    #runPromise: Promise<void> | null = null

    constructor(maxBuffer = 800) {
        this.#maxBuffer = maxBuffer
    }

    // ── 只读门面 ──
    get logs() {
        return this.#logs
    }
    get connected() {
        return this.#connected
    }
    get paused() {
        return this.#paused
    }
    get error() {
        return this.#error
    }
    get lastUpdated() {
        return this.#lastUpdated
    }
    get maxBuffer() {
        return this.#maxBuffer
    }

    // ── 派生 ──
    readonly count = $derived(this.#logs.length)
    readonly isEmpty = $derived(this.#logs.length === 0)

    // ── Action ──
    resetFilters() {
        this.search = "";
        this.activeScope = "__all__";
        this.activeLevels = new Set(ALL_LEVELS);
    }
    /**
     * 启动日志流消费。重复调用安全：已在运行则直接返回当前 run promise。
     */
    async start(): Promise<void> {
        if (this.#runPromise) {
            if (this.#stopping) {
                await this.#runPromise
            } else {
                log.debug('[HookLogStore] start() ignored, already running')
                return this.#runPromise
            }
        }
        log.debug('[HookLogStore] start() called')
        this.#runPromise = this.#run()
        return this.#runPromise
    }

    /**
     * 停止日志流消费。通过向 generator 发送 return signal 让其优雅退出，
     * 等待 #run() finally 块执行完毕后再 resolve，
     * 保证调用方收到 promise 时 connected 已经为 false。
     */
    async stop(): Promise<void> {
        if (!this.#runPromise) {
            log.debug('[HookLogStore] stop() ignored, not running')
            return
        }
        log.debug('[HookLogStore] stop() called, signalling stream return')
        try {
            this.#stopping = true;
            this.#connected = false;
            // 通知 generator 终止：mockHookLog 内部的 await/yield 会被打断，函数正常返回
            if (this.#stream) {
                this.abort();
                await this.#stream.return(undefined)
            }
            // 等待 #run() 的 for-await 完整退出、finally 执行完
            await this.#runPromise
            // log.info('[HookLogStore] stopped')
        } catch (err) {
            log.error('[HookLogStore] stop() failed', err)
        } finally {
            this.#stopping = false;
        }
    }

    /**
     * 暂停 / 恢复：不切断流，只是丢弃期间的条目。
     */
    togglePause(): void {
        this.#paused = !this.#paused
        log.debug(`[HookLogStore] paused=${this.#paused}`)
    }

    clear(): void {
        this.#logs = []
        log.debug('[HookLogStore] logs cleared')
    }

    private abort() {
        try {
            this.controller?.abort(this.abortError);
        } catch (e) {
            Logger.error("[hoo-log.store] 终止日志流监听时发生错误", e)
            // abort 本身极少抛错，兜底捕获
        } finally {
            this.controller = null;
        }
    }
    // ── 内部：流消费主循环 ──
    async #run(): Promise<void> {
        this.abort();
        this.#connected = true
        this.#error = null
        // TODO: 替换为 const stream = api().system.hookLog()
        // this.#stream = mockHookLog()
        this.controller = new AbortController();
        const { signal } = this.controller;
        this.#stream = await api().system.streamLogs({}, { signal });

        log.info('[HookLogStore] stream consumption started')
        try {
            for await (const entry of this.#stream) {
                if (this.#paused) continue
                this.#logs.push(entry)
                if (this.#logs.length > this.#maxBuffer) {
                    this.#logs.shift()
                }
                this.#lastUpdated = Date.now()
            }
            log.info('[HookLogStore] stream completed')
        } catch (err) {
            if (err === this.abortError) {
                log.info('[HookLogStore] stream consumption abort')
            } else {
                this.#error = err instanceof Error ? err.message : String(err)
                log.error('[HookLogStore] stream consumption failed', err)
            }
        } finally {
            this.#stream = null
            this.#runPromise = null
            this.#connected = false
        }
    }
}

const KEY = Symbol.for('unigen.renderer.hookLogStore');
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const hookLogStore: HookLogStore = ((globalThis as any)[KEY] ??= new HookLogStore());