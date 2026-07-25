// src/lib/utils/pluginLoader.ts
//
// 插件模块加载器 —— 原生 ESM，极简实现
//
// 职责：
//   loadModule(pluginId) —— 内置命中直接返回；否则通过 IPC 取源码字符串，eval 为 ESM 命名空间
//
// 约束（插件开发规范）：
//   - 插件必须打包为 ESM 格式
//   - 插件必须 bundle 所有依赖，不得有外部 import
//   - 所有宿主能力通过 IoC context 注入，不走 import
//
// 不持有响应式状态，专为 PluginRuntimeManager / pluginStore 服务
//─────────────────────────────────────────────────────────

import type { ModuleSource } from '@app/main/types'
import log from 'electron-log/renderer'
import pTimeout from 'p-timeout'
import { isObject } from 'radashi'
import { api } from '../api'
import { BUILTIN_MODULES } from './shared/module'

// ══════════════════════════ 类型 ══════════════════════════

/** 加载器返回的通用模块命名空间 */
export type ModuleNamespace = Record<string, unknown>

// ══════════════════════════ 常量 ══════════════════════════

/** 单模块加载超时（ms） */
const MODULE_LOAD_TIMEOUT_MS = 3_000

// ══════════════════════════ 加载器 ══════════════════════════

class ModuleLoader {
    /**
     * 并发去重：key = pluginId，value = 进行中的加载 Promise
     *
     * 同一 pluginId 并发调用 loadModule() 时，后续调用等待同一个 Promise，
     * 避免重复 IPC 请求和重复 eval。
     */
    readonly #loading = new Map<string, Promise<ModuleNamespace>>()

    // ══════════════════════════ loadModule ══════════════════════════

    /**
     * 加载插件模块，返回其 ESM 命名空间
     *
     * 流程：
     *   内置命中 → 直接返回平台内部组件（无 IPC / eval）
     *   并发去重 → 等待进行中的 Promise
     *   首次加载 → IPC 取源码 → Blob URL + 原生 import → 返回
     *
     * - 超时后抛 TimeoutError（来自 p-timeout，外部直接 import 判断）
     * - Blob URL 在 import 完成后立即回收，不影响模块有效性
     * - 命名空间由上游（PluginRuntimeManager）持有
     *
     * @param pluginId  插件唯一标识 / 内置模块 specifier
     */
    async loadModule(pluginId: string): Promise<ModuleNamespace> {
        // ── 内置模块命中 ──
        const builtin = BUILTIN_MODULES[pluginId]
        if (builtin !== undefined) {
            log.debug(`[PluginLoader] builtin module hit: ${pluginId}`)
            return builtin as ModuleNamespace
        }

        // ── 并发去重 ──
        const inflight = this.#loading.get(pluginId)
        if (inflight) {
            log.debug(`[PluginLoader] awaiting in-flight load: ${pluginId}`)
            return inflight
        }

        const promise = pTimeout(this.#doLoad(pluginId), {
            milliseconds: MODULE_LOAD_TIMEOUT_MS,
            message: `[PluginLoader] loading "${pluginId}" timed out after ${MODULE_LOAD_TIMEOUT_MS}ms`,
        })
        this.#loading.set(pluginId, promise)

        try {
            return await promise
        } finally {
            this.#loading.delete(pluginId)
        }
    }

    // ══════════════════════════ 内部实现 ══════════════════════════

    async #doLoad(pluginId: string): Promise<ModuleNamespace> {
        // 1. 通过 IPC 取源码
        const source = await api().plugin.load(pluginId) as ModuleSource
        if (!isObject(source) || !source.code) {
            throw new Error(`[PluginLoader] Failed to fetch module source for "${pluginId}"`)
        }
        log.debug(`[PluginLoader] source fetched, pluginId=${pluginId}`)

        // 2. 创建 Blob URL → import → 立即回收
        //    revokeObjectURL 只释放 URL 到 Blob 数据的映射，
        //    不影响 V8 已解析编译并持有的模块图。
        const blob = new Blob([source.code], { type: 'application/javascript' })
        const url = URL.createObjectURL(blob)

        try {
            const ns = await import(/* @vite-ignore */ url) as ModuleNamespace
            log.info(`[PluginLoader] module loaded: ${pluginId}`)
            return ns
        } finally {
            URL.revokeObjectURL(url)
        }
    }
}

// ══════════════════════════ 单例导出 ══════════════════════════
const KEY = Symbol.for('unigen.renderer.moduleLoader');
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const moduleLoader: ModuleLoader = ((globalThis as any)[KEY] ??= new ModuleLoader());