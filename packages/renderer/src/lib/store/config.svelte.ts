// src/lib/store/config.svelte.ts
import { api } from '$lib/utils/api';
import { KeybindConfig } from '$lib/utils/commands/config.svelte';
import evtbus from '$lib/utils/evtbus';
import type { AppConfig, Model, Provider } from '@app/main/types';
import log from 'electron-log/renderer';
import { setMode } from "mode-watcher";
import { toast } from 'svelte-sonner';

export const DefInputToken = 256000;
export const DefOutputToken = 8192;
export const DefScore = 50;


const themeOrder: AppConfig['theme'][] = ["light", "dark", "system"];

// ── Store ──

class ConfigStore {
    // ── 私有状态：配置项 ──
    #theme = $state<AppConfig['theme']>('system') // 原始值（三选一枚举） → $state
    #lang = $state<string>('zh-CN')              // 原始值 → $state
    #embedModel = $state<string>('')                   // 原始值 → $state
    #localModel = $state<string>('')                   // 原始值 → $state
    #providers = $state<Provider[]>([])           // 复合对象整体替换 → $state.raw
    #autoupdate = $state<boolean>(true)
    #disableHA = $state<boolean>(false)
    #silentSave = $state<boolean>(false)
    #parallelRun = $state<boolean>(false)
    #telemetry = $state<string>("");

    #itemsPerPage = $state(10);
    #fontSize = $state(14);
    #lineHeight = $state(22);
    #lineNumbers = $state(true);
    #rmblueprint = $state(false);

    // ── 私有状态：init 异步状态机 ──
    #isLoading = $state(false)
    #error = $state<string | null>(null)

    // ── 私有状态：save 异步状态机（并发安全计数器） ──
    #savingCount = $state(0)                               // 原始值 → $state
    #saveError = $state<string | null>(null)
    #lastSaved = $state<number | null>(null)

    public keybinding: KeybindConfig
    // ── 只读门面：配置项 ──
    get theme() { return this.#theme }
    get lang() { return this.#lang }
    get embedModel() { return this.#embedModel }
    get localModel() { return this.#localModel }
    get providers() { return this.#providers }
    get autoupdate() { return this.#autoupdate }
    get disableHA() { return this.#disableHA }
    get itemsPerPage() { return this.#itemsPerPage }
    get fontSize() { return this.#fontSize }
    get lineHeight() { return this.#lineHeight }
    get lineNumbers() { return this.#lineNumbers }
    get rmblueprint() { return this.#rmblueprint }
    get silentSave() { return this.#silentSave }
    get parallelRun() { return this.#parallelRun }
    get telemetry() { return this.#telemetry }

    // ── 只读门面：init 异步状态 ──
    get isLoading() { return this.#isLoading }
    get error() { return this.#error }

    // ── 只读门面：save 异步状态 ──
    get isSaving() { return this.#savingCount > 0 }
    get saveError() { return this.#saveError }
    get lastSaved() { return this.#lastSaved }

    // ── 派生 ──
    /** 当前是否暗色主题（不含 system，仅精确匹配 'dark'） */
    readonly isDark = $derived(this.#theme === 'dark')

    /** 是否已配置至少一个 Provider */
    readonly hasProviders = $derived(this.#providers.length > 0)

    /** Provider 总数 */
    readonly providerCount = $derived(this.#providers.length)

    /** 模型总数 */
    readonly totalModels = $derived(this.#providers.reduce((total, curr) => total + curr.models.length, 0))

    /** 所有 Provider 下 Model 总数 */
    readonly totalModelCount = $derived.by(() =>
        this.#providers.reduce((sum, p) => sum + p.models.length, 0),
    )

    /** embed_model 是否指向外部服务 */
    readonly isExternalEmbed = $derived(this.#embedModel.startsWith('external:'))

    private updStoreValue(name: string, value: unknown) {
        switch (name) {
            case 'theme':
                this.#theme = value as AppConfig['theme'];
                break;
            case 'lang':
                {
                    const nlang = value as AppConfig['lang'];
                    if (this.#lang !== nlang) {
                        evtbus.emit("lang:changed", nlang)
                    }
                }
                break;
            case 'embed_model':
                this.#embedModel = value as AppConfig['embed_model'];
                break;
            case 'local_model':
                this.#localModel = value as AppConfig['local_model'];
                break;
            case 'models':
                this.#providers = value as AppConfig['models'];
                break;
            case 'autoupdate':
                this.#autoupdate = value as AppConfig['autoupdate'];
                break;
            case 'disableHA':
                this.#disableHA = value as AppConfig['disableHA'];
                break;
            case 'itemsPerPage':
                this.#itemsPerPage = value as AppConfig['itemsPerPage'];
                break;
            case 'fontSize':
                this.#fontSize = value as AppConfig['fontSize'];
                break;
            case 'lineHeight':
                this.#lineHeight = value as AppConfig['lineHeight'];
                break;
            case 'lineNumbers':
                this.#lineNumbers = value as AppConfig['lineNumbers'];
                break;
            case 'rmblueprint':
                this.#rmblueprint = value as AppConfig['rmblueprint'];
                break;
            case 'silentSave':
                this.#silentSave = value as AppConfig['silentSave'];
                break;
            case 'parallelRun':
                this.#parallelRun = value as AppConfig['parallelRun'];
                break;
            case 'telemetry':
                this.#telemetry = value as AppConfig['telemetry'];
                break;
            case 'keybindings':
                this.keybinding.onKeybindingUpdate(value as AppConfig['keybindings'])
                break;
            default:
                log.warn(`[ConfigStore] received cfg:set but not implement:${name}`)
        }
    }

    constructor() {
        log.info('[ConfigStore] initialized')
        this.keybinding = new KeybindConfig();
        // 被动监听：外部通知需要重新加载配置
        evtbus.on("sys:usedark", (bDark) => {
            if (this.#theme === 'system') {
                setMode(bDark ? "dark" : "light");
            }
        })

        // eslint-disable-next-line @typescript-eslint/no-this-alias
        const that = this;
        evtbus.on("before-input-evt", (evt) => {
            if ((evt.ctrlKey || evt.metaKey) && evt.key === 'w') {
                // console.log("keybinding=", that.keybinding)
                setTimeout(() => {
                    that.keybinding.trigger('ctrl+w')
                }, 10);
            }
        })

        evtbus.on('cfg:setall', (cfg: AppConfig) => {
            this.applyConfig(cfg);
            log.debug('[ConfigStore] received cfg:setall')
        })
        evtbus.on('cfg:set', ({ name, value }) => {
            this.updStoreValue(name, value)
        })
    }

    private applyConfig(config: AppConfig) {
        this.#theme = config.theme
        if (this.#lang !== config.lang) {
            this.#lang = config.lang
            evtbus.emit("lang:changed", config.lang)
        }
        this.#embedModel = config.embed_model
        this.#localModel = config.local_model
        this.#providers = config.models
        this.#autoupdate = config.autoupdate
        this.#disableHA = config.disableHA
        this.#itemsPerPage = config.itemsPerPage
        this.#fontSize = config.fontSize
        this.#lineHeight = config.lineHeight
        this.#lineNumbers = config.lineNumbers
        this.#rmblueprint = config.rmblueprint
        this.#silentSave = config.silentSave
        this.#parallelRun = config.parallelRun
        this.#telemetry = config.telemetry

        this.applyTheme();
        this.keybinding.onKeybindingUpdate(config.keybindings);
    }

    // ═══════════════════════════════════════
    //  Actions — init
    // ═══════════════════════════════════════

    /** 初始化：读取全部配置项，分发到各私有字段 */
    async init(): Promise<void> {
        log.debug('[ConfigStore] init() called')
        this.#isLoading = true
        this.#error = null
        try {
            const config: AppConfig = await api().config.getAll() as unknown as AppConfig;

            this.applyConfig(config);

            log.info(
                `[ConfigStore] config loaded, theme=${config.theme}, lang=${config.lang}, ` +
                `${config.models.length} providers`,
            )
        } catch (err) {
            this.#error = err instanceof Error ? err.message : String(err)
            log.error('[ConfigStore] init() failed', err)
        } finally {
            this.#isLoading = false
        }
    }

    // ═══════════════════════════════════════
    //  Actions — 单项配置 setter
    // ═══════════════════════════════════════
    async cycleTheme(): Promise<void> {
        const idx = themeOrder.indexOf(this.#theme);
        this.setTheme(themeOrder[(idx + 1) % themeOrder.length]);
    }

    /** 设置主题 */
    async setTheme(value: AppConfig['theme']): Promise<void> {
        log.debug(`[ConfigStore] setTheme() called, value=${value}`)
        this.#savingCount++
        this.#saveError = null
        try {
            await api().config.set({
                key: 'theme',
                value
            })
            this.#theme = value
            await this.applyTheme()
            this.#lastSaved = Date.now()
            log.info(`[ConfigStore] theme set to "${value}"`)
        } catch (err) {
            this.#saveError = err instanceof Error ? err.message : String(err)
            log.error('[ConfigStore] setTheme() failed', err)
            toast.error(this.#saveError);
        } finally {
            this.#savingCount--
        }
    }

    async setDisableHA(value: AppConfig['disableHA']): Promise<void> {
        log.debug(`[ConfigStore] setTheme() called, value=${value}`)
        this.#savingCount++
        this.#saveError = null
        try {
            await api().config.set({
                key: 'disableHA',
                value
            })
            this.#disableHA = value
            this.#lastSaved = Date.now()
            log.info(`[ConfigStore] theme set to "${value}"`)
        } catch (err) {
            this.#saveError = err instanceof Error ? err.message : String(err)
            log.error('[ConfigStore] setDisableHA() failed', err)
            toast.error(this.#saveError);
        } finally {
            this.#savingCount--
        }
    }


    private async applyTheme() {
        if (this.#theme === 'system') {
            const mode = (await api().config.useDark()) ? "dark" : "light";
            setMode(mode);
            return;
        }
        setMode(this.#theme);
    }

    /** 设置语言 */
    async setLang(value: string): Promise<void> {
        log.debug(`[ConfigStore] setLang() called, value=${value}`)
        this.#savingCount++
        this.#saveError = null
        try {
            await api().config.set({
                key: 'lang',
                value
            })
            if (this.#lang !== value) {
                this.#lang = value
                evtbus.emit("lang:changed", value)
            }
            this.#lastSaved = Date.now()
            log.info(`[ConfigStore] lang set to "${value}"`)
        } catch (err) {
            this.#saveError = err instanceof Error ? err.message : String(err)
            log.error('[ConfigStore] setLang() failed', err)
            toast.error(this.#saveError);
        } finally {
            this.#savingCount--
        }
    }


    async setConfig(key: string, value: unknown): Promise<void> {
        log.debug(`[ConfigStore] setConfig() called,key=${key} value=${value}`)
        this.#savingCount++
        this.#saveError = null
        try {
            await api().config.set({
                key,
                value
            })
            this.updStoreValue(key, value)
            this.#lastSaved = Date.now()
            log.info(`[ConfigStore] ${key} set to "${value}"`)
        } catch (err) {
            this.#saveError = err instanceof Error ? err.message : String(err)
            log.error('[ConfigStore] set ${key} failed', err)
            toast.error(this.#saveError);
        } finally {
            this.#savingCount--
        }
    }

    async setAll(config: Record<string, unknown>): Promise<void> {
        await api().config.setAll(config);
        this.applyConfig(config as unknown as AppConfig);
    }

    /** 设置嵌入模型名称 */
    async setEmbedModel(value: string): Promise<void> {
        log.debug(`[ConfigStore] setEmbedModel() called, value=${value}`)
        this.#savingCount++
        this.#saveError = null
        try {
            await api().config.set({
                key: 'embed_model',
                value
            })
            this.#embedModel = value
            this.#lastSaved = Date.now()
            log.info(`[ConfigStore] embed_model set to "${value}"`)
        } catch (err) {
            this.#saveError = err instanceof Error ? err.message : String(err)
            log.error('[ConfigStore] setEmbedModel() failed', err)
            toast.error(this.#saveError);
        } finally {
            this.#savingCount--
        }
    }
    async setAutoupdate(value: boolean): Promise<void> {
        log.debug(`[ConfigStore] setAutoupdate() called, value=${value}`)
        this.#savingCount++
        this.#saveError = null
        try {
            await api().config.set({
                key: 'autoupdate',
                value
            })
            this.#autoupdate = value
            this.#lastSaved = Date.now()
            log.info(`[ConfigStore] setAutoupdate set to "${value}"`)
        } catch (err) {
            this.#saveError = err instanceof Error ? err.message : String(err)
            log.error('[ConfigStore] setAutoupdate() failed', err)
            toast.error(this.#saveError);
        } finally {
            this.#savingCount--
        }
    }

    /** 设置本地模型名称 */
    async setLocalModel(value: string): Promise<void> {
        log.debug(`[ConfigStore] setLocalModel() called, value=${value}`)
        this.#savingCount++
        this.#saveError = null
        try {
            await api().config.set({
                key: 'local_model',
                value
            })
            this.#localModel = value
            this.#lastSaved = Date.now()
            log.info(`[ConfigStore] local_model set to "${value}"`)
        } catch (err) {
            this.#saveError = err instanceof Error ? err.message : String(err)
            log.error('[ConfigStore] setLocalModel() failed', err)
            toast.error(this.#saveError);
        } finally {
            this.#savingCount--
        }
    }

    // ═══════════════════════════════════════
    //  Actions — Provider 管理（持久化整个 models 数组）
    // ═══════════════════════════════════════

    /** 整体替换 Provider 列表 */
    async setProviders(providers: Provider[]): Promise<void> {
        log.debug(`[ConfigStore] setProviders() called, count=${providers.length}`)
        this.#savingCount++
        this.#saveError = null
        try {
            await api().config.set({
                key: 'models',
                value: providers
            })
            this.#providers = providers
            this.#lastSaved = Date.now()
            log.info(`[ConfigStore] providers replaced, ${providers.length} total`)
        } catch (err) {
            this.#saveError = err instanceof Error ? err.message : String(err)
            log.error('[ConfigStore] setProviders() failed', err)
            toast.error(this.#saveError);
        } finally {
            this.#savingCount--
        }
    }

    async upsertProvider(provider: Provider): Promise<void> {
        if (this.#providers.find(p => p.id === provider.id)) {
            return await this.updateProvider(provider);
        }
        return await this.addProvider(provider);
    }

    /** 新增 Provider */
    async addProvider(provider: Provider): Promise<void> {
        log.debug(`[ConfigStore] addProvider() called, id=${provider.id}`)
        if (this.#providers.some((p) => p.id === provider.id)) {
            log.error(`[ConfigStore] addProvider() duplicate id="${provider.id}"`)
            this.#saveError = `Provider "${provider.id}" already exists`
            return
        }
        await this.setProviders([...this.#providers, provider])
    }

    /** 移除 Provider */
    async removeProvider(id: string): Promise<void> {
        log.debug(`[ConfigStore] removeProvider() called, id=${id}`)
        const next = this.#providers.filter((p) => p.id !== id)
        if (next.length === this.#providers.length) {
            log.debug(`[ConfigStore] removeProvider() no-op, id="${id}" not found`)
            return
        }
        await this.setProviders(next)
    }

    /** 更新 Provider（按 id 匹配替换） */
    async updateProvider(provider: Provider): Promise<void> {
        log.debug(`[ConfigStore] updateProvider() called, id=${provider.id}`)
        let found = false
        const next = this.#providers.map((p) => {
            if (p.id === provider.id) {
                found = true
                provider.models = p.models;
                return provider
            }
            return p
        })
        if (!found) {
            log.error(`[ConfigStore] updateProvider() id="${provider.id}" not found`)
            this.#saveError = `Provider "${provider.id}" not found`
            return
        }
        await this.setProviders(next)
    }


    /** 整体替换 models 列表 */
    private async setModels(pid: string, models: Model[]): Promise<void> {
        this.#savingCount++
        this.#saveError = null
        try {
            const provider = this.#providers.find((p) => p.id === pid)
            if (provider) {
                provider.models = models;
            }
            await api().config.set({
                key: 'models',
                value: this.#providers
            })
            this.#lastSaved = Date.now()
            log.info(`[ConfigStore] models replaced for ${pid}, ${models.length} total`)
        } catch (err) {
            this.#saveError = err instanceof Error ? err.message : String(err)
            log.error('[ConfigStore] setModels() failed', err)
            toast.error(this.#saveError);
        } finally {
            this.#savingCount--
        }
    }

    /** 移除 Provider */
    async removeModel(pid: string, mid: string): Promise<void> {
        log.debug(`[ConfigStore] removeModel() called, pid=${pid},mid=${mid}`)
        const provider = this.#providers.find((p) => p.id === pid)
        if (provider) {
            const next = provider.models.filter((m) => m.id !== mid);
            if (next.length === provider.models.length) {
                log.debug(`[ConfigStore] removeModel() no-op, mid="${mid}" not found`)
                return
            }
            await this.setModels(provider.id, next)
        }
    }

    /** 新增 model */
    private async addModel(provider: Provider, model: Model): Promise<void> {
        if (provider.models.some((m) => m.id === model.id)) {
            log.error(`[ConfigStore] addModel() duplicate id="${model.id}"`)
            this.#saveError = `Model id ${model.id} in Provider "${provider.id}" already exists`
            return
        }
        await this.setModels(provider.id, [...provider.models, model])
    }

    /** 更新 model（按 id 匹配替换） */
    async upsertModel(pid: string, model: Model): Promise<void> {
        log.debug(`[ConfigStore] updateModel() called, pid=${pid},mid=${model.id}`)
        const provider = this.#providers.find((p) => p.id === pid)
        if (provider) {
            let found = false

            const next = provider.models.map((m) => {
                if (m.id === model.id) {
                    found = true
                    return model
                }
                return m
            })
            if (!found) {
                //新建模型。
                await this.addModel(provider, model);
                // log.error(`[ConfigStore] updateModel() id="${model.id}" in ${pid} not found`)
                // this.#saveError = `id="${model.id}" in Provider "${pid}" not found`
                return
            }
            await this.setModels(pid, next)
        }
    }

    // ═══════════════════════════════════════
    //  纯查询（同步，无副作用）
    // ═══════════════════════════════════════

    /** 按 id 查找 Provider（返回 raw 引用，只读使用） */
    findProviderById(id: string): Provider | undefined {
        return this.#providers.find((p) => p.id === id)
    }

    /** 按 id 查找 Model（跨所有 Provider 扁平搜索） */
    findModelById(pid: string, modelId: string): { provider: Provider; model: Provider['models'][number] } | undefined {
        const provider = this.findProviderById(pid);
        if (provider) {
            const model = provider.models.find((m) => m.id === modelId)
            if (model) return { provider, model }
        }
        return undefined
    }
}


const KEY = Symbol.for('unigen.renderer.configStore');
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const configStore: ConfigStore = ((globalThis as any)[KEY] ??= new ConfigStore());