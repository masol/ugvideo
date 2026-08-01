/**
 * 私有搜索/筛选 Store —— 仅供当前目录下的模型配置组件族共享。
 * 使用 Svelte 5 Runes class 模式。
 */
import {
    FUNCTION_CAPABILITIES,
    type ModelAbility
} from "$lib/utils/model/types";

export class SearchStore {
    searchQuery = $state("");
    /** 当前选中的功能 Tab（null 表示"全部"）；与 abilities 多选互不影响 */
    activeFunctionTab = $state<ModelAbility | null>(null);
    activeAbilityFilters = $state<string[]>([]);

    isFiltering = $derived(
        this.searchQuery.trim() !== "" ||
        this.activeFunctionTab !== null ||
        this.activeAbilityFilters.length > 0,
    );

    /**
     * 当前 function 下允许出现的能力 chips。
     * · 未选中 function 时返回空数组（搜索界面据此隐藏能力筛选区）
     * · 选中 function 时仅返回该 function 拥有的 tag（不含 function/version 自身）
     */
    currentFunctionCapabilities = $derived(
        (this.activeFunctionTab &&
            FUNCTION_CAPABILITIES[this.activeFunctionTab]) ||
        [],
    );

    /**
     * 切换功能 Tab：
     * · 再次点击同一项 → 回到"全部"并清空所有能力标签
     * · 切换到不同 function → 清空所有能力标签（强制对齐新 function 的能力集合）
     */
    toggleFunctionTab(ability: ModelAbility) {
        if (this.activeFunctionTab === ability) {
            this.activeFunctionTab = null;
            this.activeAbilityFilters = [];
            return;
        }
        this.activeFunctionTab = ability;
        this.activeAbilityFilters = [];
    }

    toggleAbilityFilter(ability: string) {
        // 防御：仅允许勾选当前 function 拥有的能力
        // eslint-disable-next-line svelte/prefer-svelte-reactivity
        const allowed = new Set<string>(this.currentFunctionCapabilities as string[]);
        if (this.activeFunctionTab && !allowed.has(ability)) return;
        const idx = this.activeAbilityFilters.indexOf(ability);
        if (idx >= 0) {
            this.activeAbilityFilters.splice(idx, 1);
        } else {
            this.activeAbilityFilters.push(ability);
        }
    }

    clearAllFilters() {
        this.searchQuery = "";
        this.activeFunctionTab = null;
        this.activeAbilityFilters = [];
    }
}

const KEY = Symbol.for('unigen.renderer.searchStore');
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const searchStore: SearchStore = ((globalThis as any)[KEY] ??= new SearchStore());