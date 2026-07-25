// src/lib/store/inputManager.svelte.ts
/**
 * 输入管理面板 — 跨组件响应式 Store
 * 约束：所有子组件均通过此 Store 通信，组件彼此零耦合。
 * 架构：Svelte 5 Runes 类 Store 模式（纯客户端 · 模块级单例）。
 */

import { api } from '$lib/utils/api';
import log from 'electron-log/renderer';
import { DbKeys } from '../../../../../lib/utils/service/dbkeys';
import type { ScriptItem } from './types';


class InputManagerStore {
    // ── 剧本库（细粒度增删改 → $state） ──
    #scripts = $state<ScriptItem[]>([]);
    #synopsis = $state<string>("");
    #charSpec = $state<string>("");
    #bookName = $state<string>("");
    #requirements = $state<string>("");

    // ── 三个平级参考区块 ──
    #visualStyle = $state<string[]>([]); // 画面风格
    // #bgm = $state<ReferenceItem[]>([]);         // BGM
    // #voiceover = $state<ReferenceItem[]>([]);   // 画外音

    // ── 异步状态机（默认加载中 → true） ──
    #isLoading = $state(true);
    #error = $state<string | null>(null);
    #lastUpdated = $state<number | null>(null);

    // 重入保护：记录是否有进行中的 init，避免并发覆盖 loading 节奏
    #initInFlight = false;

    // ── 只读门面 ──
    get scripts() { return this.#scripts; }
    get visualStyle() { return this.#visualStyle; }
    get synopsis() { return this.#synopsis; }
    get charSpec() { return this.#charSpec; }
    get bookName() { return this.#bookName; }
    get requirements() { return this.#requirements; }

    // get bgm() { return this.#bgm; }
    // get voiceover() { return this.#voiceover; }


    get isLoading() { return this.#isLoading; }
    get error() { return this.#error; }
    get lastUpdated() { return this.#lastUpdated; }

    // ── 派生 ──
    readonly hasScripts = $derived(this.#scripts.length > 0);



    // 各区块统计（按 kind 计数）
    readonly referenceStats = $derived.by(() => {
        return {
            visualStyle: this.#visualStyle.length,
            // bgm: count(this.#bgm),
            // voiceover: count(this.#voiceover)
        };
    });

    constructor() {
    }

    // ── 初始化加载（可重入：进行中再次调用直接复用，不重置加载状态） ──
    async init(): Promise<void> {
        log.debug('[InputManagerStore] init() called');

        if (this.#initInFlight) {
            log.debug('[InputManagerStore] init() re-entered, skip (in flight)');
            return;
        }

        this.#initInFlight = true;
        this.#isLoading = true;
        this.#error = null;
        try {
            const projectApi = api().project;

            const [
                scriptsRes,
                // visualStyleRes,
                synopsisRes,
                charSpecRes,
                bookNameRes,
                requirementsRes
            ] = await Promise.all([
                projectApi.get(DbKeys.scripts),
                // projectApi.visualref(),
                projectApi.get(DbKeys.synopsis),
                projectApi.get(DbKeys.character_specifications),
                projectApi.get(DbKeys.book_name),
                projectApi.get(DbKeys.requirements),
            ]);

            // 2. 统一进行赋值和类型断言
            this.#scripts = (scriptsRes ?? []) as ScriptItem[];
            // this.#visualStyle = visualStyleRes;
            this.#synopsis = (synopsisRes ?? "") as string;
            this.#charSpec = (charSpecRes ?? "") as string;
            this.#bookName = (bookNameRes ?? "") as string;
            this.#requirements = (requirementsRes ?? "") as string;


            this.#lastUpdated = Date.now();
        } catch (err) {
            this.#error = err instanceof Error ? err.message : String(err);
            log.error('[InputManagerStore] init() failed', err);
        } finally {
            // init 完毕重置加载状态
            this.#isLoading = false;
            this.#initInFlight = false;
        }
    }

    private async persistScript(id: string, text: string, next: ScriptItem[]) {
        await api().project.set({
            key: DbKeys.ScriptbyId(id),
            value: text
        });
        await api().project.set({
            key: DbKeys.scripts,
            value: next
        })
    }

    async getContent(id: string): Promise<string> {
        try {
            const content = await api().project.get(`script_${id}`) as string;
            return content ?? ""
        } catch (err) {
            this.#error = err instanceof Error ? err.message : String(err);
            log.error('[InputManagerStore] addScript() failed', err);
            throw this.#error
        }
    }

    // ── 剧本操作（异步） ──
    async addScript(content: string): Promise<void> {
        log.debug('[InputManagerStore] addScript() called');
        const text = typeof content === 'string' ? content : '';
        if (text.length <= 0) {
            return;
        }
        const time = Date.now();
        const id = crypto.randomUUID();
        const item: ScriptItem = {
            id,
            size: text.length,
            updatedAt: time
        };
        const next = [...this.#scripts, item];
        try {
            await this.persistScript(id, content, next);
            this.#scripts = next;
            this.#lastUpdated = Date.now();
            log.info(`[InputManagerStore] script added, id=${item.id}`);
        } catch (err) {
            this.#error = err instanceof Error ? err.message : String(err);
            log.error('[InputManagerStore] addScript() failed', err);
        }
    }

    async updateScript(
        id: string,
        content: string
    ): Promise<void> {
        log.debug(`[InputManagerStore] updateScript() called, id=${id}`);
        const next = this.#scripts.map((s) =>
            s.id === id ? { ...s, size: content.length, updatedAt: Date.now() } : s
        );
        try {
            await this.persistScript(id, content, next);
            this.#scripts = next;
            this.#lastUpdated = Date.now();
            log.info(`[InputManagerStore] script updated, id=${id}`);
        } catch (err) {
            this.#error = err instanceof Error ? err.message : String(err);
            log.error('[InputManagerStore] updateScript() failed', err);
        }
    }

    async removeScript(id: string): Promise<void> {
        log.debug(`[InputManagerStore] removeScript() called, id=${id}`);
        const next = this.#scripts.filter((s) => s.id !== id);
        try {
            // TODO: 替换为 await api().deleteScript(id)
            await api().project.rm(DbKeys.ScriptbyId(id));
            await api().project.set({
                key: DbKeys.scripts,
                value: next
            });
            this.#scripts = next;
            this.#lastUpdated = Date.now();
            log.info(`[InputManagerStore] script removed, id=${id}`);
        } catch (err) {
            this.#error = err instanceof Error ? err.message : String(err);
            log.error('[InputManagerStore] removeScript() failed', err);
        }
    }

    async addVisualRef(_images: string[]): Promise<void> {

        // const tmpResult = await api().project.addvref(images);
        // console.log("tmpResult=", tmpResult)
        // this.#visualStyle = [...this.#visualStyle, ...tmpResult]
    }

    async rmVisualRef(image: string): Promise<void> {
        // await api().project.rmvref([image])
        this.#visualStyle = this.#visualStyle.filter((vs) => vs !== image);
    }

    // synopsis,character_specifications,book_name，requirements
    async setCommon(keyName: keyof typeof DbKeys, value: string): Promise<void> {
        await api().project.set({
            key: keyName,
            value
        })
        if (keyName === DbKeys.synopsis) {
            this.#synopsis = value;
        } else if (keyName === DbKeys.character_specifications) {
            this.#charSpec = value;
        } else if (keyName === DbKeys.book_name) {
            this.#bookName = value;
        } else if (keyName === DbKeys.requirements) {
            this.#requirements = value;
        }
    }
}

const KEY = Symbol.for('unigen.renderer.inputStore');
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const inputStore: InputManagerStore = ((globalThis as any)[KEY] ??= new InputManagerStore());