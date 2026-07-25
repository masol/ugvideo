/* eslint-disable @typescript-eslint/no-explicit-any */
// src/lib/store/layout.svelte.ts
// ═══════════════════════════════════════════════════════════════
// LayoutStore — 主窗口布局编排单例
// 职责：Activity 选中态 · 左侧栏动态注册 · 三面板 开/关/最大化 · 可见性派生
// 所有操作均为同步状态切换，无异步 I/O，故不设 isLoading/error/lastUpdated
// ═══════════════════════════════════════════════════════════════

import type { LeftSidebarItem } from '$lib/utils/plugin/extpoint/leftsidebar'
import log from 'electron-log/renderer'
import type { Component } from 'svelte'
import { SvelteMap } from 'svelte/reactivity'
import bottomActivities from '../../../route/featured/leftside/bottom'
// ─── 类型 ────────────────────────────────────────────────────

/** 三个可控面板位置 */
export type PanelPosition = 'left' | 'bottom' | 'right'

/**
 * 面板 Header 左侧展示的组件类型
 * - 使用 Component<any> 兼容各种 props 签名
 * - null 表示该面板当前无 header 组件
 */
export type PanelHeaderComponent = Component<any> | null

// ─── Store ──────────────────────────────────────────────────
class LayoutStore {

    // ══════════════════════════════════════════════════════════
    //  Activity Bar — 上方动态注册项
    //  使用 Map 存储便于 O(1) 查找/删除；对外暴露排序后的数组
    //  Map 内部有增删 mutation → $state（深度响应）
    // ══════════════════════════════════════════════════════════
    #topActivityMap = $state<Map<string, LeftSidebarItem>>(new SvelteMap())

    /** 按 order 升序排列的活动栏项目（只读派生） */
    readonly topActivities = $derived.by(() => {
        return Array.from(this.#topActivityMap.values()).sort(
            (a, b) => (a.order ?? 100) - (b.order ?? 100),
        )
    })

    // ── Activity Bar — 下方固定项（无需动态注册） ──
    readonly bottomActivities: LeftSidebarItem[] = bottomActivities

    // ══════════════════════════════════════════════════════════
    //  面板开关（原始布尔值 → $state，无 Proxy 开销）
    // ══════════════════════════════════════════════════════════
    #isLeftOpen = $state(false)
    #isBottomOpen = $state(false)
    #isRightOpen = $state(false)

    get isLeftOpen(): boolean { return this.#isLeftOpen }
    get isBottomOpen(): boolean { return this.#isBottomOpen }
    get isRightOpen(): boolean { return this.#isRightOpen }

    // ══════════════════════════════════════════════════════════
    //  面板 Header 组件
    //  左侧 header 由 Activity 注册项的 header 字段驱动
    //  底部 / 右侧 header 由外部子组件主动注入
    //  组件引用只做整体替换 → $state.raw
    // ══════════════════════════════════════════════════════════
    #leftHeaderComponent = $state.raw<Component<any> | null>(null)
    #bottomHeaderComponent = $state.raw<Component<any> | null>(null)
    #rightHeaderComponent = $state.raw<Component<any> | null>(null)

    get leftHeaderComponent(): Component<any> | null { return this.#leftHeaderComponent }
    get bottomHeaderComponent(): Component<any> | null { return this.#bottomHeaderComponent }
    get rightHeaderComponent(): Component<any> | null { return this.#rightHeaderComponent }

    // ══════════════════════════════════════════════════════════
    //  左侧栏当前渲染的内容组件（由 Activity 注册项的 component 字段驱动）
    //  组件引用只做整体替换 → $state.raw
    // ══════════════════════════════════════════════════════════
    #leftContentComponent = $state.raw<Component<any> | null>(null)

    get leftContentComponent(): Component<any> | null { return this.#leftContentComponent }

    // ══════════════════════════════════════════════════════════
    //  最大化面板（三态互斥 + null，原始值 → $state）
    // ══════════════════════════════════════════════════════════
    #maximizedPanel = $state<PanelPosition | null>(null)

    get maximizedPanel(): PanelPosition | null { return this.#maximizedPanel }

    // ══════════════════════════════════════════════════════════
    //  当前激活项（原始字符串 → $state）
    // ══════════════════════════════════════════════════════════
    #activeActivity = $state<string | null>(null)

    get activeActivity(): string | null { return this.#activeActivity }
    get activeProps(): Record<string, unknown> {
        return this.activeActivityItem?.props ?? {}
    }

    readonly activeActivityItem = $derived.by(() => {
        if (!this.#activeActivity) {
            return null;
        }
        const top = this.#topActivityMap.get(this.#activeActivity);
        if (top) return top;
        return this.bottomActivities.find(item => item.id === this.#activeActivity) ?? null;
    });
    // ══════════════════════════════════════════════════════════
    //  派生 — 面板可见性（UI 模板直接绑定）
    // ══════════════════════════════════════════════════════════

    /** 左侧栏：自身打开，且未被其他面板最大化挤占 */
    readonly showLeft = $derived(
        this.#isLeftOpen && (this.#maximizedPanel === null || this.#maximizedPanel === 'left'),
    )

    /** 底部面板：自身打开，且未被其他面板最大化挤占 */
    readonly showBottom = $derived(
        this.#isBottomOpen && (this.#maximizedPanel === null || this.#maximizedPanel === 'bottom'),
    )

    /** 右侧栏：自身打开，且未被其他面板最大化挤占 */
    readonly showRight = $derived(
        this.#isRightOpen && (this.#maximizedPanel === null || this.#maximizedPanel === 'right'),
    )

    /** 主编辑区：无面板最大化时才显示 */
    readonly showMainEditor = $derived(this.#maximizedPanel === null)

    /** 是否有任意面板处于最大化 */
    readonly isAnyMaximized = $derived(this.#maximizedPanel !== null)

    // ══════════════════════════════════════════════════════════
    //  派生 — PaneGroup 重挂载 Key
    //  面板组合变化时，用新 key 强制 PaneGroup 销毁重建
    // ══════════════════════════════════════════════════════════

    readonly horizontalKey = $derived(
        `h-${this.#isLeftOpen}-${this.#isRightOpen}-${this.#maximizedPanel}`,
    )

    readonly verticalKey = $derived(
        `v-${this.#isBottomOpen}-${this.#maximizedPanel}`,
    )

    // ══════════════════════════════════════════════════════════
    //  构造
    // ══════════════════════════════════════════════════════════

    constructor() {
        log.info('[LayoutStore] initialized')
    }

    // ══════════════════════════════════════════════════════════
    //  Actions — Activity 注册 / 注销
    // ══════════════════════════════════════════════════════════

    /**
     * 是否给定id当前已经被注册。
     * @param actId 
     * @returns 
     */
    hasActivity(actId: string): boolean {
        if (this.#topActivityMap.has(actId)) {
            return true;
        }
        if (this.bottomActivities.find((act) => act.id === actId)) {
            return true;
        }
        return false;
    }

    /**
     * 注册一个左侧栏 Activity 项目
     * 重复 id 会覆盖已有项，注册后列表自动按 order 排序（派生）
     */
    addActivity(item: LeftSidebarItem): void {
        log.debug(`[LayoutStore] addActivity() id=${item.id}, order=${item.order ?? 100}`)

        if (this.#topActivityMap.has(item.id)) {
            log.info(`[LayoutStore] addActivity() overwriting existing id=${item.id}`)
        }

        this.#topActivityMap.set(item.id, item)
        // this.#topActivityMap = new Map(this.#topActivityMap);
        log.info(`[LayoutStore] activity registered, id=${item.id}, total=${this.#topActivityMap.size}`)
    }

    /**
     * 注销一个左侧栏 Activity 项目
     * 若当前激活项被移除，自动清空激活态并关闭左侧栏
     */
    removeActivity(id: string): void {
        log.debug(`[LayoutStore] removeActivity() id=${id}`)

        if (!this.#topActivityMap.has(id)) {
            log.warn(`[LayoutStore] removeActivity() id=${id} not found, ignored`)
            return
        }

        this.#topActivityMap.delete(id)

        // 被移除的恰好是当前激活项 → 清空
        if (this.#activeActivity === id) {
            this.#activeActivity = null
            this.#leftHeaderComponent = null
            this.#leftContentComponent = null
            this.#isLeftOpen = false
            log.info(`[LayoutStore] active activity removed, left panel closed`)
        }

        log.info(`[LayoutStore] activity unregistered, id=${id}, total=${this.#topActivityMap.size}`)
    }

    // ══════════════════════════════════════════════════════════
    //  Actions — Activity Bar 交互
    // ══════════════════════════════════════════════════════════

    /**
     * 点击 Activity 条目：
     *  - 再次点击已激活项 → 折叠左侧栏
     *  - 点击其他项 → 切换并展开左侧栏，从注册项读取 header/component
     *    若其他面板最大化则退出最大化
     *  - id 未注册 → 仅 warn 日志，不做任何状态变更
     */
    handleActivityClick(id: string): void {
        log.debug(`[LayoutStore] handleActivityClick() id=${id}`)

        let item = this.#topActivityMap.get(id)
        if (!item) {
            item = this.bottomActivities.find(item => item.id === id);
            if (!item) {
                log.warn(`[LayoutStore] handleActivityClick() id=${id} not found in registry, ignored`)
                return
            }
        }

        if (this.#activeActivity === id && this.#isLeftOpen) {
            // 再次点击 → 折叠
            this.#isLeftOpen = false
        } else {
            // 切换到新项
            this.#activeActivity = id
            this.#leftHeaderComponent = item.header ?? null
            this.#leftContentComponent = item.component
            this.#isLeftOpen = true
            // 左侧栏展开时，若其他面板处于最大化，退出最大化
            if (this.#maximizedPanel !== null && this.#maximizedPanel !== 'left') {
                this.#maximizedPanel = null
            }
        }
    }

    /**
     * 直接设置激活的 Activity（不影响面板开关）
     * 从注册项读取 header/component
     * id 未注册 → 仅 warn 日志
     */
    setActiveActivity(id: string): void {
        log.debug(`[LayoutStore] setActiveActivity() id=${id}`)

        const item = this.#topActivityMap.get(id)
        if (!item) {
            log.warn(`[LayoutStore] setActiveActivity() id=${id} not found in registry, ignored`)
            return
        }

        this.#activeActivity = id
        this.#leftHeaderComponent = item.header ?? null
        this.#leftContentComponent = item.component
    }

    // ══════════════════════════════════════════════════════════
    //  Actions — 底部 / 右侧面板 Header 组件（由外部设置）
    //  底部和右侧面板的 header 组件由子组件按需注入
    // ══════════════════════════════════════════════════════════

    /**
     * 设置底部面板的 header 组件
     * 由底部面板的子组件在挂载时调用
     *
     * @param component header 组件，传 null 清除
     */
    setBottomHeaderComponent(component: Component<any> | null): void {
        log.debug('[LayoutStore] setBottomHeaderComponent()')
        this.#bottomHeaderComponent = component
    }

    /**
     * 设置右侧面板的 header 组件
     * 由右侧面板的子组件在挂载时调用
     *
     * @param component header 组件，传 null 清除
     */
    setRightHeaderComponent(component: Component<any> | null): void {
        log.debug('[LayoutStore] setRightHeaderComponent()')
        this.#rightHeaderComponent = component
    }

    // ══════════════════════════════════════════════════════════
    //  Actions — 面板开关 / 最大化 / 关闭
    // ══════════════════════════════════════════════════════════

    /** 切换面板开关，关闭时同步退出该面板的最大化 */
    togglePanel(panel: PanelPosition): void {
        log.debug(`[LayoutStore] togglePanel() panel=${panel}`)

        switch (panel) {
            case 'left':
                this.#isLeftOpen = !this.#isLeftOpen
                break
            case 'bottom':
                this.#isBottomOpen = !this.#isBottomOpen
                break
            case 'right':
                this.#isRightOpen = !this.#isRightOpen
                break
        }

        // 面板关闭 → 退出其最大化
        if (this.#maximizedPanel === panel) {
            this.#maximizedPanel = null
        }
    }

    /** 打开指定面板（幂等） */
    openPanel(panel: PanelPosition): void {
        log.debug(`[LayoutStore] openPanel() panel=${panel}`)

        switch (panel) {
            case 'left':
                this.#isLeftOpen = true
                break
            case 'bottom':
                this.#isBottomOpen = true
                break
            case 'right':
                this.#isRightOpen = true
                break
        }
    }

    /** 关闭指定面板，同步退出其最大化 */
    closePanel(panel: PanelPosition): void {
        log.debug(`[LayoutStore] closePanel() panel=${panel}`)

        switch (panel) {
            case 'left':
                this.#isLeftOpen = false
                break
            case 'bottom':
                this.#isBottomOpen = false
                break
            case 'right':
                this.#isRightOpen = false
                break
        }

        if (this.#maximizedPanel === panel) {
            this.#maximizedPanel = null
        }
    }

    /** 切换面板最大化 ↔ 还原 */
    toggleMaximizePanel(panel: PanelPosition): void {
        log.debug(`[LayoutStore] toggleMaximizePanel() panel=${panel}`)
        this.#maximizedPanel = this.#maximizedPanel === panel ? null : panel
    }

    /** 退出所有最大化 */
    exitMaximize(): void {
        log.debug('[LayoutStore] exitMaximize()')
        this.#maximizedPanel = null
    }

    // ══════════════════════════════════════════════════════════
    //  重置为默认布局
    // ══════════════════════════════════════════════════════════

    resetToDefaults(): void {
        this.#isLeftOpen = true
        this.#isBottomOpen = false
        this.#isRightOpen = false
        this.#maximizedPanel = null
        this.#activeActivity = null
        this.#leftHeaderComponent = null
        this.#leftContentComponent = null
        this.#bottomHeaderComponent = null
        this.#rightHeaderComponent = null
        // 注意：不清空 #topActivityMap，注册项由插件生命周期管理

        // 若有注册项，默认激活第一个
        const sorted = this.topActivities
        if (sorted.length > 0) {
            this.#activeActivity = sorted[0].id
            this.#leftHeaderComponent = sorted[0].header ?? null
            this.#leftContentComponent = sorted[0].component
        }

        log.info('[LayoutStore] reset to defaults')
    }
}

// ── 单例导出 ──
const KEY = Symbol.for('unigen.renderer.layoutStore');
export const layoutStore: LayoutStore = ((globalThis as any)[KEY] ??= new LayoutStore());