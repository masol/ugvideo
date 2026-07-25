// src/lib/utils/plugin.ts
//
// 插件运行时管理器—— 基于 Awilix DI 容器（scoped 隔离）
// 纯工具类，不持有任何响应式状态，专为 pluginStore 服务
// ─────────────────────────────────────────────────────────────

import { isPlatformService } from '$lib/types/plugin/platform'
import { type PluginModule } from '$lib/types/plugin/plugin'
import {
    asValue,
    type AwilixContainer,
    createContainer,
    InjectionMode,
} from 'awilix'
import log from 'electron-log/renderer'
import { assertPluginModule } from './guard'
import { moduleLoader } from './loader'
import { PLATFORM_SERVICES } from './shared/service'

// ══════════════════════════ 公开类型 ══════════════════════════

/** 单次操作的反馈，供 pluginStore 据此更新状态 */
export interface PluginLoadResult {
    pluginId: string
    success: boolean
    errorMessage?: string
}

// ══════════════════════════ 内部类型 ══════════════════════════

/** 已成功加载的插件运行时信息 */
interface PluginRuntime {
    readonly module: PluginModule
    readonly scope: AwilixContainer
}

// ══════════════════════════ 运行时管理器 ══════════════════════════

class PluginRuntimeManager {
    /** 根容器 —— 存放平台级服务，插件 scope 继承可见 */
    readonly #root: AwilixContainer

    /** pluginId → 运行时（仅成功加载的插件） */
    readonly #runtimes = new Map<string, PluginRuntime>()

    /** init() 是否已执行 */
    #initialized = false

    constructor() {
        this.#root = createContainer({
            injectionMode: InjectionMode.PROXY,
            strict: true,
        })
        log.info('[PluginRuntime] root container created')
    }

    // ── 初始化 ────────────────────────────────────────────────

    /**
     * 初始化运行时
     *
     * 1. 初始化 pluginLoader（SystemJS 环境 + 内置共享模块）
     * 2. 将 PLATFORM_SERVICES 全部注入根容器
     *
     * 幂等：重复调用无副作用
     */
    init(): void {
        if (this.#initialized) {
            log.debug('[PluginRuntime] already initialized, skip')
            return
        }

        // 2. 将平台服务注入根容器
        //    value 已经是 IPlatformService 实例（引用传递，asValue 不复制）
        let count = 0
        for (const [key, service] of Object.entries(PLATFORM_SERVICES)) {
            // 运行时守卫：确保注册的一定是合法平台服务
            if (!isPlatformService(service)) {
                log.warn(
                    `[PluginRuntime] PLATFORM_SERVICES["${key}"] is not a valid IPlatformService, skipped`,
                )
                continue
            }
            this.#root.register(key, asValue(service))
            log.debug(
                `[PluginRuntime] platform service registered: ${key} ` +
                `(${service.meta.serviceId}@${service.meta.version}, ` +
                `caps=[${service.meta.capabilities.join(', ')}])`,
            )
            count++
        }

        this.#initialized = true
        log.info(`[PluginRuntime] initialized — ${count} platform service(s) registered`)
    }

    // ── 查询（无副作用） ──────────────────────────────────────

    /** 插件是否已加载到运行时 */
    isLoaded(pluginId: string): boolean {
        return this.#runtimes.has(pluginId)
    }

    /** 当前所有已加载的 pluginId */
    getLoadedIds(): string[] {
        return [...this.#runtimes.keys()]
    }

    /** 获取插件模块实例（未加载返回 undefined） */
    getModule(pluginId: string): PluginModule | undefined {
        return this.#runtimes.get(pluginId)?.module
    }

    /** 获取插件的隔离容器（未加载返回 undefined） */
    getScope(pluginId: string): AwilixContainer | undefined {
        return this.#runtimes.get(pluginId)?.scope
    }

    /**
     * 从指定插件的 scoped 容器中解析服务
     * @throws 插件未加载 或 服务未注册 时抛出
     */
    resolve<T = unknown>(pluginId: string, name: string): T {
        const scope = this.#runtimes.get(pluginId)?.scope
        if (!scope) {
            throw new Error(
                `[PluginRuntime] cannot resolve "${name}" — plugin not loaded: ${pluginId}`,
            )
        }
        return scope.resolve<T>(name)
    }

    /** 指定插件的容器中是否注册了指定 key */
    hasRegistration(pluginId: string, name: string): boolean {
        return this.#runtimes.get(pluginId)?.scope.hasRegistration(name) ?? false
    }

    // ── 核心操作 ──────────────────────────────────────────────

    /**
     * 加载并激活单个插件
     *
     * 流程：pluginLoader.loadModule → createScope → register → activate → 存入 map
     * 幂等：已加载的插件直接返回 success
     *
     * @param pluginId 永久唯一的插件标识
     */
    async loadPlugin(pluginId: string): Promise<PluginLoadResult> {
        this.#assertInitialized()

        if (this.#runtimes.has(pluginId)) {
            log.debug(`[PluginRuntime] already loaded, skip: ${pluginId}`)
            return { pluginId, success: true }
        }

        // 1. 通过 loader 获取模块（含并发去重、依赖递归解析）
        let module: PluginModule
        try {
            module = assertPluginModule(await moduleLoader.loadModule(pluginId), pluginId)
        } catch (err) {
            const errorMessage = err instanceof Error ? err.message : String(err)
            log.error(`[PluginRuntime] loadModule failed: ${pluginId}`, err)
            return { pluginId, success: false, errorMessage }
        }

        // 2. 创建隔离 scope，可 resolve 根容器的平台服务
        const scope = this.#root.createScope()

        try {
            // register 阶段：插件向自己的 scope 注册服务
            await module.register(scope)

            // activate 阶段（可选）：scope 内所有依赖已就绪
            if (module.activate) {
                await module.activate(scope)
            }

            this.#runtimes.set(pluginId, { module, scope })
            log.info(`[PluginRuntime] loaded: ${pluginId}`)
            return { pluginId, success: true }
        } catch (err) {
            // 失败时销毁 scope，不留残余
            await this.#disposeScope(scope)
            const errorMessage = err instanceof Error ? err.message : String(err)
            log.error(`[PluginRuntime] load failed: ${pluginId}`, err)
            return { pluginId, success: false, errorMessage }
        }
    }

    /**
     * 停用并卸载单个插件
     *
     * 流程：deactivate → dispose scope → pluginLoader.unloadModule → 移除 map
     * 幂等：未加载的插件直接返回 success
     */
    async unloadPlugin(pluginId: string): Promise<PluginLoadResult> {
        const runtime = this.#runtimes.get(pluginId)
        if (!runtime) {
            log.debug(`[PluginRuntime] not loaded, skip unload: ${pluginId}`)
            return { pluginId, success: true }
        }

        try {
            if (runtime.module.deactivate) {
                await runtime.module.deactivate(runtime.scope)
            }
            await this.#disposeScope(runtime.scope)
            this.#runtimes.delete(pluginId)

            // 从 SystemJS 注册表移除，允许热重载时获取新版本
            // moduleLoader.unloadModule(pluginId)

            log.info(`[PluginRuntime] unloaded: ${pluginId}`)
            return { pluginId, success: true }
        } catch (err) {
            // 即便出错也强制移除，防止僵尸状态
            this.#runtimes.delete(pluginId)
            await this.#disposeScope(runtime.scope)
            // moduleLoader.unloadModule(pluginId)
            const errorMessage = err instanceof Error ? err.message : String(err)
            log.error(`[PluginRuntime] unload failed: ${pluginId}`, err)
            return { pluginId, success: false, errorMessage }
        }
    }

    /**
     * 卸载后重新加载（热重载场景）
     * loader 会重新从后端拉取最新源码
     */
    async reloadPlugin(pluginId: string): Promise<PluginLoadResult> {
        const unloadResult = await this.unloadPlugin(pluginId)
        if (!unloadResult.success) {
            return unloadResult
        }
        return this.loadPlugin(pluginId)
    }

    /**
     * 全部卸载 —— 逆序卸载（先加载的后卸载，减少依赖冲突）
     * 最后调用平台服务的 dispose 钩子，再销毁根容器自身
     */
    async disposeAll(): Promise<PluginLoadResult[]> {
        log.debug('[PluginRuntime] disposeAll()')

        const ids = [...this.#runtimes.keys()].reverse()
        const results: PluginLoadResult[] = []

        for (const id of ids) {
            results.push(await this.unloadPlugin(id))
        }

        // 调用平台服务 dispose 钩子
        for (const [key, service] of Object.entries(PLATFORM_SERVICES)) {
            if (typeof service.dispose === 'function') {
                try {
                    await service.dispose()
                    log.debug(`[PluginRuntime] platform service disposed: ${key}`)
                } catch (err) {
                    log.warn(`[PluginRuntime] platform service dispose error: ${key}`, err)
                }
            }
        }

        await this.#root.dispose()
        this.#initialized = false

        const failed = results.filter((r) => !r.success).length
        log.info(
            `[PluginRuntime] disposed all — ${results.length} plugins, ${failed} failed`,
        )
        return results
    }

    // ── 内部辅助 ──────────────────────────────────────────────

    #assertInitialized(): void {
        if (!this.#initialized) {
            throw new Error(
                '[PluginRuntime] not initialized — call pluginRuntime.init() first',
            )
        }
    }

    /** 安全销毁 scope，静默吞错 */
    async #disposeScope(scope: AwilixContainer): Promise<void> {
        try {
            await scope.dispose()
        } catch (err) {
            log.warn('[PluginRuntime] scope dispose error (ignored)', err)
        }
    }
}

// ══════════════════════════ 单例导出 ══════════════════════════

const KEY = Symbol.for('unigen.renderer.pluginRuntime');
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const pluginRuntime: PluginRuntimeManager = ((globalThis as any)[KEY] ??= new PluginRuntimeManager());