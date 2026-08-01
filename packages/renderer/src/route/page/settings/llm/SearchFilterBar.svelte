<!-- SearchFilterBar.svelte -->
<script lang="ts">
  import { Input } from "$lib/components/ui/input";
  import {
    FUNCTION_ABILITIES,
    tagIcons,
    tagLabels
  } from "$lib/utils/model/types";
  import { IconFilterOff, IconSearch, IconX } from "@tabler/icons-svelte";
  import { searchStore } from "./searchstore.svelte";

  let {
    filteredProviderCount = 0,
    filteredModelCount = 0,
  }: {
    filteredProviderCount?: number;
    filteredModelCount?: number;
  } = $props();

  const functions = FUNCTION_ABILITIES;

  /** 当前 function 下可用的能力 chips（无 function 时为空 → 不渲染） */
  const currentCaps = $derived(searchStore.currentFunctionCapabilities);
</script>

<div
  class="space-y-4 rounded-2xl border border-border/50 bg-card p-6 shadow-sm"
>
  <!-- 搜索输入 -->
  <div class="relative">
    <IconSearch
      size={16}
      stroke={1.5}
      class="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground"
    />
    <Input
      value={searchStore.searchQuery}
      oninput={(e: Event) => {
        searchStore.searchQuery = (e.currentTarget as HTMLInputElement).value;
      }}
      placeholder="搜索提供商或模型名称 / ID"
      class="rounded-xl pl-9 pr-9"
    />
    {#if searchStore.searchQuery}
      <button
        class="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground transition-colors duration-200 hover:text-foreground"
        onclick={() => {
          searchStore.searchQuery = "";
        }}
        type="button"
        aria-label="清除搜索"
      >
        <IconX size={14} stroke={1.5} />
      </button>
    {/if}
  </div>

  <!-- 功能 Tab（互斥单选，再次点击取消；切换时自动清空标签） -->
  <div class="flex flex-wrap items-center gap-2">
    <span class="mr-1 text-xs text-muted-foreground">功能(单选)</span>
    {#each functions as ability (ability)}
      {@const AbIcon = tagIcons[ability]}
      {@const active = searchStore.activeFunctionTab === ability}
      <button
        type="button"
        aria-pressed={active}
        class={[
          "flex cursor-pointer items-center gap-1.5 rounded-lg border px-2.5 py-1 text-xs transition-all duration-200",
          active
            ? "border-primary/50 bg-primary/10 text-primary shadow-sm"
            : "border-border/50 bg-background text-muted-foreground hover:bg-muted hover:text-foreground",
        ]}
        onclick={() => searchStore.toggleFunctionTab(ability)}
      >
        <AbIcon size={12} stroke={1.5} />
        {tagLabels[ability]}
      </button>
    {/each}
  </div>

  <!--
    能力多选 Chips：仅在选中 function 时渲染，且只展示该 function 拥有的 tag。
    · 无 function tab → 整块隐藏（避免跨功能 tag 互相干扰）
    · 切换 function → 由 store 自动清空旧 tag
  -->
  {#if searchStore.activeFunctionTab && currentCaps.length > 0}
    <div class="flex animate-fade-in flex-wrap items-center gap-2">
      <span class="mr-1 text-xs text-muted-foreground">能力(或)</span>
      {#each currentCaps as ability (ability)}
        {@const AbIcon = tagIcons[ability]}
        {@const active = searchStore.activeAbilityFilters.includes(ability)}
        <button
          type="button"
          aria-pressed={active}
          class={[
            "flex cursor-pointer items-center gap-1.5 rounded-lg border px-2.5 py-1 text-xs transition-all duration-200",
            active
              ? "border-sky-500/50 bg-sky-500/10 text-sky-600 dark:text-sky-400"
              : "border-border/50 bg-background text-muted-foreground hover:bg-muted hover:text-foreground",
          ]}
          onclick={() => searchStore.toggleAbilityFilter(ability)}
        >
          <AbIcon size={12} stroke={1.5} />
          {tagLabels[ability]}
        </button>
      {/each}
      {#if searchStore.isFiltering}
        <button
          type="button"
          class="ml-2 flex cursor-pointer items-center gap-1 rounded-lg px-2 py-1 text-xs text-muted-foreground transition-colors duration-200 hover:text-foreground"
          onclick={() => searchStore.clearAllFilters()}
        >
          <IconFilterOff size={12} stroke={1.5} />
          清除
        </button>
      {/if}
    </div>
  {/if}

  <!-- 筛选结果统计 -->
  {#if searchStore.isFiltering}
    <p class="animate-fade-in text-xs text-muted-foreground">
      找到 {filteredProviderCount} 个提供商，{filteredModelCount} 个模型
    </p>
  {/if}
</div>
