/**
 * 搜索设置 Store。
 * 模型：扁平列表，每项 = 一个 SERP 后端（type + apiKey + enabled）。
 */

import type { SearchProviderConfig } from "./types";
import { SERP_PROVIDERS } from "./types";

function meta(type: SearchProviderConfig["type"]) {
    const m = SERP_PROVIDERS.find((p) => p.type === type);
    if (!m) throw new Error(`Unknown provider type: ${type}`);
    return m;
}

function buildProvider(type: SearchProviderConfig["type"], apiKey = ""): SearchProviderConfig {
    const m = meta(type);
    return { id: type, type, name: m.name, apiKey, enabled: true };
}

const MOCK_PROVIDERS: SearchProviderConfig[] = [
    buildProvider("serper", ""),
];

class SearchConfigStore {
    providers = $state<SearchProviderConfig[]>(MOCK_PROVIDERS);

    enabledProviders = $derived(this.providers.filter((p) => p.enabled).length);

    /** 已被添加的 type 集合，用于下拉过滤 */
    usedTypes = $derived(new Set(this.providers.map((p) => p.type)));

    /** 可供添加的 type（未使用过） */
    availableTypes = $derived(
        SERP_PROVIDERS.filter((m) => !this.usedTypes.has(m.type)),
    );

    /** 模糊搜索可添加的提供商 */
    searchAvailable(query: string) {
        const q = query.trim().toLowerCase();
        if (!q) return this.availableTypes;
        return this.availableTypes.filter(
            (m) =>
                m.name.toLowerCase().includes(q) ||
                m.type.includes(q),
        );
    }

    addProvider(type: SearchProviderConfig["type"]) {
        if (this.usedTypes.has(type)) return;
        this.providers.push(buildProvider(type, ""));
    }

    removeProvider(id: string) {
        const idx = this.providers.findIndex((x) => x.id === id);
        if (idx >= 0) this.providers.splice(idx, 1);
    }

    updateProvider(id: string, updates: Partial<SearchProviderConfig>) {
        const p = this.providers.find((x) => x.id === id);
        if (p) Object.assign(p, updates);
    }
}

export const searchStore = new SearchConfigStore();