// $lib/components/glossary/glossary-store.svelte.ts
import { configStore } from '$lib/store/config.svelte';
import { projectStore } from '$lib/store/project.svelte';
import { safeApi } from '$lib/utils/api';
import type { BlueprintFilterOption, BlueprintKind } from '@app/main/types';
import log from 'electron-log/renderer';
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
                    const uuid = match[1]; // 提取出的 UUID
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
            `[BlueprintStore] #doLoad() kind=${this.#kind}, name="${this.#name}", page=${this.#pageIndex}, size=${this.#pageSize}`,
        )
        this.#isLoading = true
        this.#error = null
        try {
            const page = await safeApi().project.list({
                kind: this.#kind,
                name: this.#name,
                pageIndex: this.#pageIndex,
                pageSize: this.#pageSize,
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
        this.load()
    }

    setName(value: string): void {
        log.debug(`[BlueprintStore] setName("${value}")`)
        this.#name = value
        this.#pageIndex = 0
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