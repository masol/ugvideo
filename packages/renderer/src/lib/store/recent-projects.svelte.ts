import { safeApi } from '$lib/utils/api'
import evtbus from '$lib/utils/evtbus'
// import evtbus from '$lib/utils/evtbus'
import type { RecentProject } from '@app/main/types'
import log from 'electron-log/renderer'

class RecentProjectsStore {
    // ── 私有状态 ──
    // 列表只做整体替换（每次 load 后重新赋值），用 raw 避免深度 Proxy 开销
    #projects = $state.raw<RecentProject[]>([])
    #isLoading = $state(false)
    #error = $state<string | null>(null)

    // ── 只读门面 ──
    get projects() { return this.#projects }
    get isLoading() { return this.#isLoading }
    get error() { return this.#error }

    // ── 派生 ──
    readonly isEmpty = $derived(this.#projects.length === 0)
    readonly count = $derived(this.#projects.length)

    constructor() {
        log.info('[RecentProjectsStore] initialized')

        // 外部如有"最近项目变更"通知，被动刷新；只听不发
        evtbus.on('recent:projects', (recents: RecentProject[]) => {
            this.#projects = recents;
            // void this.load()
        })
    }

    // ── Action ──
    // 系统初始时调用，后续通过事件自动同步。
    async load(): Promise<void> {
        if (this.#isLoading) return
        log.debug('[RecentProjectsStore] load() called')
        this.#isLoading = true
        this.#error = null
        try {
            const result = await safeApi().config.recents()
            this.#projects = result
            log.info(`[RecentProjectsStore] data loaded, ${result.length} items`)
        } catch (err) {
            this.#error = err instanceof Error ? err.message : String(err)
            log.error('[RecentProjectsStore] load() failed', err)
        } finally {
            this.#isLoading = false
        }
    }

    async clear(): Promise<void> {
        log.debug(`[RecentProjectsStore] clear() called`)
        try {
            await safeApi().config.recents(true);
        } catch (err) {
            log.error('[RecentProjectsStore] open() failed', err)
        }
    }
}

const KEY = Symbol.for('unigen.renderer.recentProjectsStore');
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const recentProjectsStore: RecentProjectsStore = ((globalThis as any)[KEY] ??= new RecentProjectsStore());