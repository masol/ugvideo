// src/lib/store/router.svelte.ts

import log from "electron-log/renderer";
import type { Component } from "svelte";
import {
    wrap,
    type AsyncSvelteComponent, // 懒加载 loader 标准类型
} from "svelte-spa-router/wrap";
import EmojiGallery from '../../../route/page/dev/emoji-gallery.svelte';
import IconGallery from '../../../route/page/dev/icon-gallery.svelte';
import IconPlayground from "../../../route/page/dev/icon-playground.svelte";
import EditorPage from '../../../route/page/editor/EditorPage.svelte';
import FallbackComponent from "../../../route/page/fallback/Main.svelte";
import FlowPage from "../../../route/page/flow/FlowPage.svelte";
import DevSetting from "../../../route/page/settings/develops/DevSettingsPanel.svelte";
import GeneralSetting from "../../../route/page/settings/general/general.svelte";
import Keybindings from '../../../route/page/settings/Keybindings.svelte';
import LLMSetting from "../../../route/page/settings/llm/llm.svelte";
import MCPSetting from '../../../route/page/settings/mcp/mcp.svelte';
import ProjectTypeManager from '../../../route/page/settings/project-type/ProjectTypeManager.svelte';
import MCPSearchSetting from '../../../route/page/settings/search/search.svelte';

// ── 类型 ──

/** svelte-spa-router 路由值：普通组件 或 wrap() 返回的包装对象 */
type RouteDefinitionValue = Component | ReturnType<typeof wrap>;

/** 路由表：路径 → 组件 */
type RouteMap = Record<string, RouteDefinitionValue>;

/** 批量注册条目 */
interface RouteEntry {
    path: string;
    component: RouteDefinitionValue;
}

// ── Store ──

class RouterStore {
    // ── 私有状态 ──

    /**
     * 路由表 — 整体替换触发 svelte-spa-router 重渲染 → $state.raw
     * 初始即包含 fallback '*'
     */
    #routes: RouteMap = $state.raw({
        "/settings/models/llm": LLMSetting,
        "/settings/api/mcp": MCPSetting,
        "/settings/api/search": MCPSearchSetting,
        "/settings/general": GeneralSetting,
        "/settings/develops": DevSetting,
        "/settings/keybindings": Keybindings,
        "/settings/projectype": ProjectTypeManager,
        '/flow/view/:id': FlowPage,
        // content 为可选查询/路径参数
        '/editor/:kind/:id': EditorPage,
        '/editor/:kind/:id/:content?': EditorPage,
        '/dev/icons': IconGallery,
        '/dev/emojis': EmojiGallery,
        '/dev/icon-playground': IconPlayground,
        "*": FallbackComponent,
    });

    // ── 只读门面 ──

    get routes() {
        return this.#routes;
    }

    // ── 派生 ──

    /** 已注册路径列表 */
    readonly registeredPaths = $derived(Object.keys(this.#routes));

    /** 路由总数 */
    readonly routeCount = $derived(Object.keys(this.#routes).length);

    /** 路由表是否非空 */
    readonly hasRoutes = $derived(Object.keys(this.#routes).length > 0);

    // ── 构造 ──

    constructor() {
        log.info("[RouterStore] initialized");
    }

    // ── Actions ──

    /**
     * 添加一条静态路由
     * @returns true 成功，false 路径已存在
     */
    addRoute(path: string, component: RouteDefinitionValue): boolean {
        log.debug(`[RouterStore] addRoute(), path=${path}`);

        if (this.#routes[path]) {
            log.debug(`[RouterStore] addRoute() skipped, already exists: ${path}`);
            return false;
        }

        this.#routes = { ...this.#routes, [path]: component };
        log.info(
            `[RouterStore] route added: ${path}, total ${Object.keys(this.#routes).length}`,
        );
        return true;
    }

    /**
     * 添加一条懒加载路由
     * @param path   路径
     * @param loader 动态导入函数，如 () => import('./pages/Foo.svelte')
     * @returns true 成功，false 路径已存在
     */
    addLazyRoute(path: string, loader: AsyncSvelteComponent): boolean {
        log.debug(`[RouterStore] addLazyRoute(), path=${path}`);

        if (this.#routes[path]) {
            log.debug(
                `[RouterStore] addLazyRoute() skipped, already exists: ${path}`,
            );
            return false;
        }

        // 不再粗暴断言 object，完全匹配 WrapOptions.asyncComponent 类型
        const wrapped = wrap({ asyncComponent: loader });
        this.#routes = { ...this.#routes, [path]: wrapped };
        log.info(
            `[RouterStore] lazy route added: ${path}, total ${Object.keys(this.#routes).length}`,
        );
        return true;
    }

    /**
     * 批量添加（仅一次引用替换）
     * @returns 实际成功添加的数量
     */
    addBatchRoutes(entries: RouteEntry[]): number {
        log.debug(`[RouterStore] addBatchRoutes(), count=${entries.length}`);

        const merged = { ...this.#routes };
        let added = 0;

        for (const { path, component } of entries) {
            if (merged[path]) {
                log.debug(`[RouterStore] batch skipping existing: ${path}`);
                continue;
            }
            merged[path] = component;
            added++;
        }

        if (added > 0) {
            this.#routes = merged;
            log.info(
                `[RouterStore] batch added ${added} route(s), total ${Object.keys(merged).length}`,
            );
        }

        return added;
    }

    /**
     * 删除一条路由（禁止删除 fallback '*'）
     * @returns true 成功，false 不存在或为 fallback
     */
    removeRoute(path: string): boolean {
        log.debug(`[RouterStore] removeRoute(), path=${path}`);

        if (path === "*") {
            log.debug("[RouterStore] removeRoute() rejected: cannot remove fallback");
            return false;
        }

        if (!this.#routes[path]) {
            log.debug(`[RouterStore] removeRoute() skipped, not found: ${path}`);
            return false;
        }

        const updated = { ...this.#routes };
        delete updated[path];
        this.#routes = updated;
        log.info(
            `[RouterStore] route removed: ${path}, total ${Object.keys(updated).length}`,
        );
        return true;
    }

    /**
     * 更新已有路由的组件
     * @returns true 成功，false 路径不存在
     */
    updateRoute(path: string, component: RouteDefinitionValue): boolean {
        log.debug(`[RouterStore] updateRoute(), path=${path}`);

        if (!this.#routes[path]) {
            log.debug(`[RouterStore] updateRoute() skipped, not found: ${path}`);
            return false;
        }

        this.#routes = { ...this.#routes, [path]: component };
        log.info(`[RouterStore] route updated: ${path}`);
        return true;
    }

    /** 检查路径是否已注册 */
    hasRoute(path: string): boolean {
        return path in this.#routes;
    }

    /**
     * 重置：清除除 fallback 外的所有路由
     * 保留 '*' 条目（若存在）
     */
    reset(): void {
        log.debug("[RouterStore] reset() called");

        const fallback = this.#routes["*"];
        this.#routes = fallback ? { "*": fallback } : {};
        log.info("[RouterStore] routes reset to fallback only");
    }
}

const KEY = Symbol.for('unigen.renderer.routerStore');
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const routerStore: RouterStore = ((globalThis as any)[KEY] ??= new RouterStore());