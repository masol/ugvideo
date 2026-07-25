// src/lib/store/tour.svelte.ts
import type { Step } from '$lib/components/ui/walkthrough/ctx'
import log from 'electron-log/renderer'
import { isNumber } from 'radashi'

type TourCallback = (currentStepIndex: number) => void | Promise<void>

class TourStore {
    // 不要直接设置，这是为Tour服务的。
    open = $state(false)
    // ── 私有状态 ──
    #steps = $state.raw<Step[]>([]) // 只整体替换 → raw
    #callback: TourCallback | null = null // 回调函数不需要响应式

    // ── 只读门面 ──
    get steps() { return this.#steps }


    constructor() {
        log.info('[TourStore] initialized')
    }

    async onStep(curStepIdx: number) {
        if (isNumber(curStepIdx)) {
            return await this.#callback?.(curStepIdx);
        }
    }

    // ── Action ──
    /**
     * 开启引导，必须提供步骤和回调
     */
    start(steps: Step[], callback: TourCallback | null = null): void {
        log.debug(`[TourStore] start() called, steps count=${steps.length}`)

        if (!steps || steps.length === 0) {
            log.error('[TourStore] start() failed: empty steps')
            return
        }

        this.#steps = steps
        this.#callback = callback
        this.open = true

        log.info(`[TourStore] tour started with ${steps.length} steps`)
    }

}

const KEY = Symbol.for('unigen.renderer.tourStore');
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const tourStore: TourStore = ((globalThis as any)[KEY] ??= new TourStore());