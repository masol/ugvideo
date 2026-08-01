/**
 * 搜索设置 Store。
 * 与 llm/searchstore.svelte.ts 模式一致：class + 模块单例。
 *
 * 数据模型：
 *   - providers[]  ：搜索后端接入点（每个可视为 Tavily / Brave 这样的 API 提供商）。
 *   - engines[]    ：每个 provider 下挂载的具体搜索引擎能力（通用 / 新闻 / 学术 …）。
 *   - 每个 provider 通过 providerId 字段关联其 engines。
 */

import type { SearchEngineConfig, SearchProviderConfig } from "./types";

// TODO: store bridge —— 替换为 configStore.searchProviders
const MOCK_PROVIDERS: SearchProviderConfig[] = [
    {
        id: "tavily",
        name: "Tavily",
        apiKey: "",
        endpoint: "https://api.tavily.com",
        enabled: true,
        defaultEngines: ["general", "news"],
    },
    {
        id: "brave",
        name: "Brave Search",
        apiKey: "",
        endpoint: "https://api.search.brave.com/res/v1",
        enabled: false,
        defaultEngines: ["general"],
    },
];

const MOCK_ENGINES: SearchEngineConfig[] = [
    // Tavily
    {
        id: "general",
        providerId: "brave",

        label: "通用搜索",
        category: "general",
        enabled: true,
        maxResults: 10,
        safeSearch: "moderate",
        recencyDays: 30,
    },
    {
        id: "news",
        providerId: "brave",

        label: "新闻",
        category: "news",
        enabled: true,
        maxResults: 5,
        safeSearch: "moderate",
        recencyDays: 7,
    },
    {
        id: "academic",
        providerId: "brave",

        label: "学术",
        category: "academic",
        enabled: false,
        maxResults: 8,
        safeSearch: "off",
    },
    // Brave
    {
        id: "general-brave",
        providerId: "brave",
        label: "通用搜索",
        category: "general",
        enabled: false,
        maxResults: 10,
        safeSearch: "moderate",
    },
];

class SearchConfigStore {
    providers = $state<SearchProviderConfig[]>(MOCK_PROVIDERS);
    engines = $state<SearchEngineConfig[]>(MOCK_ENGINES);

    // ── 搜索 / 筛选 ──
    searchQuery = $state("");
    categoryFilter = $state<SearchEngineConfig["category"] | "all">("all");
    showOnlyEnabled = $state(false);

    isFiltering = $derived(
        this.searchQuery.trim() !== "" ||
        this.categoryFilter !== "all" ||
        this.showOnlyEnabled,
    );

    toggleCategoryFilter(c: SearchEngineConfig["category"]) {
        this.categoryFilter = this.categoryFilter === c ? "all" : c;
    }

    toggleShowOnlyEnabled() {
        this.showOnlyEnabled = !this.showOnlyEnabled;
    }

    clearAllFilters() {
        this.searchQuery = "";
        this.categoryFilter = "all";
        this.showOnlyEnabled = false;
    }

    // ── CRUD ──
    upsertProvider(p: SearchProviderConfig) {
        const idx = this.providers.findIndex((x) => x.id === p.id);
        if (idx >= 0) this.providers[idx] = p;
        else this.providers.push(p);
    }

    removeProvider(id: string) {
        const idx = this.providers.findIndex((x) => x.id === id);
        if (idx >= 0) this.providers.splice(idx, 1);
        // 级联清理 engines
        this.engines = this.engines.filter((e) => e.providerId !== id);
    }

    toggleProviderEnabled(id: string) {
        const p = this.providers.find((x) => x.id === id);
        if (p) p.enabled = !p.enabled;
    }

    upsertEngine(e: SearchEngineConfig) {
        const idx = this.engines.findIndex((x) => x.id === e.id);
        if (idx >= 0) this.engines[idx] = e;
        else this.engines.push(e);
    }

    removeEngine(id: string) {
        const idx = this.engines.findIndex((x) => x.id === id);
        if (idx >= 0) this.engines.splice(idx, 1);
    }

    toggleEngineEnabled(id: string) {
        const e = this.engines.find((x) => x.id === id);
        if (e) e.enabled = !e.enabled;
    }

    // ── 派生 ──
    visibleEnginesForProvider = (providerId: string) => {
        const q = this.searchQuery.toLowerCase().trim();
        const cat = this.categoryFilter;
        return this.engines.filter((e) => {
            if (e.providerId !== providerId) return false;
            if (this.showOnlyEnabled && !e.enabled) return false;
            if (cat !== "all" && e.category !== cat) return false;
            if (q && !e.label.toLowerCase().includes(q) && !e.id.includes(q)) {
                return false;
            }
            return true;
        });
    };

    filteredProviders = $derived.by(() => {
        const q = this.searchQuery.toLowerCase().trim();
        if (!q && this.categoryFilter === "all" && !this.showOnlyEnabled) {
            return this.providers;
        }
        return this.providers.filter((p) => {
            if (this.showOnlyEnabled && !p.enabled) return false;
            if (q && !p.name.toLowerCase().includes(q) && !p.id.includes(q)) {
                return false;
            }
            // provider 维度不参与 category 筛选，只过滤 engine
            return true;
        });
    });

    totalEngines = $derived(this.engines.length);
    enabledProviders = $derived(this.providers.filter((p) => p.enabled).length);
    enabledEngines = $derived(this.engines.filter((e) => e.enabled).length);
}

export const searchStore = new SearchConfigStore();