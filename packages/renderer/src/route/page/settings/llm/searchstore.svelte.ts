/**
 * 私有搜索/筛选 Store —— 仅供当前目录下的模型配置组件族共享。
 * 使用 Svelte 5 Runes class 模式。
 */
export class SearchStore {
    searchQuery = $state("");
    activeAbilityFilters = $state<string[]>([]);

    isFiltering = $derived(
        this.searchQuery.trim() !== "" || this.activeAbilityFilters.length > 0,
    );

    toggleAbilityFilter(ability: string) {
        const idx = this.activeAbilityFilters.indexOf(ability);
        if (idx >= 0) {
            this.activeAbilityFilters.splice(idx, 1);
        } else {
            this.activeAbilityFilters.push(ability);
        }
    }

    clearAllFilters() {
        this.searchQuery = "";
        this.activeAbilityFilters = [];
    }
}

const KEY = Symbol.for('unigen.renderer.searchStore');
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const searchStore: SearchStore = ((globalThis as any)[KEY] ??= new SearchStore());