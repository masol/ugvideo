// $lib/components/glossary/glossary-store.svelte.ts
import { configStore } from '$lib/store/config.svelte';
import { projectStore } from '$lib/store/project.svelte';
import { safeApi } from '$lib/utils/api';
import type { BlueprintFilterOption, BlueprintKind } from '@app/main/types';
import { default as log, default as Logger } from 'electron-log/renderer';
import { debounce } from 'radashi';

/* ── 蓝图类型（三张同构表）──────────────────────────────────── */
export type { BlueprintKind };

export const BLUEPRINT_OPTIONS: { value: BlueprintKind; label: string }[] = [
    { value: 'glossary', label: '术语表' },
    { value: 'metag', label: '元术语表' },
    { value: 'capa', label: '能力表' },
]

export type BlueprintTerm = {
    name: string
    updatedAt: string
    on?: string
}

export type BlueprintPage = {
    items: BlueprintTerm[]
    total: number
    pageIndex: number
    pageSize: number
}

export type BlueprintSortBy = 'key' | 'updatedAt';
export type BlueprintSortOrder = 'asc' | 'desc';

function capaCanEdit(name: string | undefined): string {
    if (name?.startsWith('#code')) {
        return 'js'
    } else if (name?.startsWith('#workflow')) {
        return 'json'
    }
    return ''
}

export const BLUEPRINT_KINDS: readonly BlueprintKind[] = ['glossary', 'metag', 'capa'] as const

const LOAD_DEBOUNCE_MS = 200

/* ── Runes Store ─────────────────────────────────────────────── */
class BlueprintStore {
    #kind = $state<BlueprintKind>('glossary')
    #name = $state('')
    #pageIndex = $state(0)
    #pageSize = $derived(configStore.itemsPerPage)
    #sortBy = $state<BlueprintSortBy>('key')
    #sortOrder = $state<BlueprintSortOrder>('asc')

    #items = $state.raw<BlueprintTerm[]>([])
    #total = $state(0)
    #isLoading = $state(true)
    #error = $state<string | null>(null)
    #lastUpdated = $state<number | null>(null)

    #requestSeq = 0

    // ── 只读门面 ──
    get kind() { return this.#kind }
    get name() { return this.#name }
    get pageIndex() { return this.#pageIndex }
    get pageSize() { return this.#pageSize }
    get sortBy() { return this.#sortBy }
    get sortOrder() { return this.#sortOrder }
    get items() { return this.#items }
    get total() { return this.#total }
    get isLoading() { return this.#isLoading }
    get error() { return this.#error }
    get lastUpdated() { return this.#lastUpdated }

    readonly pageCount = $derived(Math.max(1, Math.ceil(this.#total / this.#pageSize)))
    readonly canPrev = $derived(this.#pageIndex > 0)
    readonly canNext = $derived(this.#pageIndex < this.pageCount - 1)
    readonly kindLabel = $derived(
        BLUEPRINT_OPTIONS.find((o) => o.value === this.#kind)?.label ?? '术语表',
    )

    /**
     * 当前 kind 对应的候选项（带描述）。
     * 数据来源：全局 projectStore.activity.blueprintFilters（由 main 下发）。
     * 空数组/未设置 → toolbar 仅显示纯 Input（与现状一致）。
     */
    readonly kindFilterOptions = $derived<BlueprintFilterOption[]>(
        projectStore.activity?.blueprintFilters?.[this.#kind] ?? [],
    )
    readonly hasFilterOptions = $derived(this.kindFilterOptions.length > 0)

    /** 防抖包装：短时间内多次触发合并为一次真实 API 调用 */
    #debouncedLoad = debounce({ delay: LOAD_DEBOUNCE_MS }, () => {
        void this.doLoad()
    })

    constructor() {
        log.info('[BlueprintStore] initialized')
    }

    canEditContent(term: BlueprintTerm): string {
        if (this.kind === 'capa') {
            const capaItem = this.#items.find(i => i.name === term.name)
            return capaCanEdit(capaItem?.on)
        }
        return ""
    }

    canShowDesign(term: BlueprintTerm): string {
        if (this.kind === 'glossary') {
            if (term.name.startsWith('.')) {
                const pattern = /^\.([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})_state$/i;
                const match = term.name.match(pattern);
                if (match) {
                    const uuid = match[1];
                    return uuid;
                }
            }
        }
        return ""
    }

    // ── 真实的加载逻辑（仅内部调用）──
    async doLoad(): Promise<void> {
        const seq = ++this.#requestSeq
        log.debug(
            `[BlueprintStore] #doLoad() kind=${this.#kind}, name="${this.#name}", page=${this.#pageIndex}, size=${this.#pageSize}, sort=${this.#sortBy}:${this.#sortOrder}`,
        )
        this.#isLoading = true
        this.#error = null
        try {
            const page = await safeApi().project.list({
                kind: this.#kind,
                name: this.#name,
                pageIndex: this.#pageIndex,
                pageSize: this.#pageSize,
                sortBy: this.#sortBy,
                sortOrder: this.#sortOrder,
            })
            if (seq !== this.#requestSeq) {
                log.debug(`[BlueprintStore] #doLoad() stale response dropped, seq=${seq}`)
                return
            }
            this.#items = page.items
            this.#total = page.total
            this.#lastUpdated = Date.now()
            log.info(`[BlueprintStore] data loaded, kind=${this.#kind}, ${page.items.length}/${page.total} items`)
        } catch (e) {
            if (seq !== this.#requestSeq) return
            this.#error = e instanceof Error ? e.message : '加载失败'
            this.#items = []
            this.#total = 0
            log.error('[BlueprintStore] #doLoad() failed', e)
        } finally {
            if (seq === this.#requestSeq) this.#isLoading = false
        }
    }

    /** 触发防抖加载：200ms 内的连续调用会合并为一次真实请求 */
    load(): void {
        this.#debouncedLoad()
    }

    /** 立即加载（跳过防抖），用于需要同步等待结果的场景 */
    async loadNow(): Promise<void> {
        this.#debouncedLoad.cancel()
        await this.doLoad()
    }

    setKind(value: BlueprintKind): void {
        if (value === this.#kind) return
        log.debug(`[BlueprintStore] setKind(${value})`)
        this.#kind = value
        this.#name = ''
        this.#pageIndex = 0
        // 切换 kind 时把排序重置为安全默认值（避免上次状态误导）
        this.#sortBy = 'key'
        this.#sortOrder = 'asc'
        this.load()
    }

    setName(value: string): void {
        log.debug(`[BlueprintStore] setName("${value}")`)
        this.#name = value
        this.#pageIndex = 0
        this.load()
    }

    /**
     * 设置排序键。若与当前一致则翻转方向，否则切到该键的默认方向。
     * 设计：与 TanStack Table 风格的「点列头排序」交互一致。
     * - key 列：默认 asc
     * - updatedAt 列：默认 desc（一般看最新）
     */
    setSortBy(value: BlueprintSortBy): void {
        if (this.#sortBy === value) {
            this.setSortOrder(this.#sortOrder === 'asc' ? 'desc' : 'asc')
            return
        }
        this.#sortBy = value
        this.#sortOrder = value === 'updatedAt' ? 'desc' : 'asc'
        this.#pageIndex = 0
        this.load()
    }

    setSortOrder(value: BlueprintSortOrder): void {
        if (this.#sortOrder === value) return
        this.#sortOrder = value
        this.#pageIndex = 0
        this.load()
    }

    /** 直接跳转到指定页（0-based）。越界会被夹紧到合法范围。 */
    goToPage(pageIndex: number): void {
        const target = Math.max(0, Math.min(this.pageCount - 1, pageIndex | 0))
        if (target === this.#pageIndex) return
        this.#pageIndex = target
        this.load()
    }

    prevPage(): void {
        if (!this.canPrev) return
        this.#pageIndex -= 1
        this.load()
    }

    nextPage(): void {
        if (!this.canNext) return
        this.#pageIndex += 1
        this.load()
    }

    /**
     * 检查指定 name 在当前 kind 下是否已存在。
     * 用于「新建」前的唯一性预检，避免跳转到编辑器后发现冲突。
     * 注：依赖 list API 的 name 搜索（默认 prefix 匹配）。调用方应当把
     * 待检测的 name 视为「精确匹配」的诉求，命中即视为存在。
     */
    async checkNameExists(name: string): Promise<boolean> {
        const trimmed = name.trim()
        if (!trimmed) return false
        log.debug(`[BlueprintStore] checkNameExists(kind=${this.#kind}, name="${trimmed}")`)
        try {
            switch (this.#kind) {
                case 'capa':
                case 'metag':
                    Logger.error(`[checkNameExists] NOT IMPLEMENT ${this.#kind} check`)
                    return false;
                case 'glossary': {
                    const result = await safeApi().project.get(trimmed);
                    return result !== null
                }
            }
        } catch (e) {
            log.error('[BlueprintStore] checkNameExists() failed', e)
            // 预检失败不应当假装「不存在」——保守地返回 true 让用户看到提示，避免覆盖。
            throw e
        }
    }

    async removeTerm(name: string): Promise<void> {
        log.debug(`[BlueprintStore] removeTerm(kind=${this.#kind}, name="${name}")`)
        try {
            switch (this.#kind) {
                case 'capa':
                    await safeApi().project.rmCapa(name)
                    break
                case 'glossary':
                    await safeApi().project.rm(name)
                    break
                case 'metag':
                    await safeApi().project.rmMetag(name)
                    break
            }
            if (this.#items.length === 1 && this.#pageIndex > 0) this.#pageIndex -= 1
            log.info(`[BlueprintStore] term removed, kind=${this.#kind}, name="${name}"`)
        } catch (e) {
            this.#error = e instanceof Error ? e.message : '删除失败'
            log.error('[BlueprintStore] removeTerm() failed', e)
        }
        await this.loadNow()
    }
}

const KEY = Symbol.for('unigen.renderer.blueprintStore');
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const blueprintStore: BlueprintStore = ((globalThis as any)[KEY] ??= new BlueprintStore());