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

    async rmProject(prjpath: string): Promise<void> {
        // 1. 检查本地是否存在该路径
        const exists = this.#projects.some(p => p.path === prjpath);
        if (!exists) {
            log.warn(`[RecentProjectsStore] rmProject() called for non-existent path: ${prjpath}`);
            return; // 不存在则直接返回，不调用后端
        }

        try {
            // 2. 调用后端删除（假设 API 成功即表示删除完成）
            await safeApi().config.recents(prjpath);

            // 3. 删除成功后，从本地数组中移除该条目（重新赋值触发响应更新）
            this.#projects = this.#projects.filter(p => p.path !== prjpath);
            log.debug(`[RecentProjectsStore] removed project: ${prjpath}`);
        } catch (err) {
            this.#error = err instanceof Error ? err.message : String(err);
            log.error('[RecentProjectsStore] rmProject() failed', err);
            throw err; // 保持错误向上传播
        }
    }
}

const KEY = Symbol.for('unigen.renderer.recentProjectsStore');
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const recentProjectsStore: RecentProjectsStore = ((globalThis as any)[KEY] ??= new RecentProjectsStore());