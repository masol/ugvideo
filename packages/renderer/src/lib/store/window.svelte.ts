// src/lib/store/window.svelte.ts
// ═══════════════════════════════════════════════════════════════
// WindowStore — 当前窗口状态管理单例
//   职责：最小化 / 最大化 / 还原 / 关闭 / 焦点 / 标题
//   前置条件：外部确保 wid 可用后才调用 init(wid)
// ═══════════════════════════════════════════════════════════════

import { api } from '$lib/utils/api'
import evtbus from '$lib/utils/evtbus'
import log from 'electron-log/renderer'

// ─── 类型 ────────────────────────────────────────────────────

/** 窗口视觉状态（三态互斥） */
export type WindowVisualState = 'normal' | 'maximized' | 'minimized'

// ─── Store ──────────────────────────────────────────────────

class WindowStore {
  // ── 窗口标识（纯内部） ──
  #wid = -1                // 原始值 

  // ── 核心状态 ──
  #visualState = $state<WindowVisualState>('normal')       // 原始值 → $state
  #isFocused = $state(true)                                // 原始值 → $state

  // ── 派生 ──
  readonly isMaximized = $derived(this.#visualState === 'maximized')
  readonly isMinimized = $derived(this.#visualState === 'minimized')
  readonly isNormal = $derived(this.#visualState === 'normal')

  readonly maxRestoreTooltip = $derived(
    this.#visualState === 'maximized' ? '向下还原' : '最大化',
  )

  get wid(): number {
    return this.#wid;
  }

  // ── 只读门面 ──
  get visualState(): WindowVisualState { return this.#visualState }
  get isFocused(): boolean { return this.#isFocused }

  // ── 构造 ──
  constructor() {
    evtbus.on('winstate', (payload) => {
      switch (payload.type) {
        case 'maximized':
        case 'minimized':
        case 'normal':
          if (this.#visualState !== payload.type) {
            this.#visualState = payload.type
          }
          break
        default:
          // log.debug('[WindowStore] unhandled winstate event:', payload)
      }
    })

    log.info('[WindowStore] initialized')
  }

  // ── 注入 wid ──
  init(wid: number): void {
    this.#wid = wid
    log.info(`[WindowStore] bound wid=${wid}`)
  }

  async maximize(): Promise<void> {
    log.debug('[WindowStore] maximize() called')
    try {
      if (await api().window.max()) {
        this.#visualState = 'maximized'
        log.info('[WindowStore] maximize() succeeded')
      }
    } catch (err) {
      log.error('[WindowStore] maximize() failed', err)
    }
  }

  async minimize(): Promise<void> {
    log.debug('[WindowStore] minimize() called')
    try {
      if (await api().window.min()) {
        this.#visualState = 'minimized'
        log.info('[WindowStore] minimize() succeeded')
      }
    } catch (err) {
      log.error('[WindowStore] minimize() failed', err)
    }
  }

  async restore(): Promise<void> {
    log.debug('[WindowStore] restore() called')
    try {
      if (await api().window.restore()) {
        this.#visualState = 'normal'
        log.info('[WindowStore] restore() succeeded')
      }
    } catch (err) {
      log.error('[WindowStore] restore() failed', err)
    }
  }

  async toggleMaximize(): Promise<void> {
    if (this.#visualState === 'maximized') {
      await this.restore()
    } else {
      await this.maximize()
    }
  }

  async focus(): Promise<void> {
    log.debug('[WindowStore] focus() called')
    try {
      if (await api().window.focus()) {
        this.#isFocused = true
        log.info('[WindowStore] focus() succeeded')
      }
    } catch (err) {
      log.error('[WindowStore] focus() failed', err)
    }
  }

  async close(): Promise<void> {
    log.debug('[WindowStore] close() called')
    try {
      if (await api().window.close()) {
        log.info('[WindowStore] close() succeeded')
      }
    } catch (err) {
      log.error('[WindowStore] close() failed', err)
    }
  }
}

const KEY = Symbol.for('unigen.renderer.windowStore');
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const windowStore: WindowStore = ((globalThis as any)[KEY] ??= new WindowStore());