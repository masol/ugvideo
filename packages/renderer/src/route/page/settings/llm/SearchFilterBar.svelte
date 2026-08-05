<!-- SearchFilterBar.svelte -->
<script lang="ts">
  import { Input } from "$lib/components/ui/input";
  import {
    FUNCTION_ABILITIES,
    tagIcons,
    tagLabels,
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
      placeholder="搜索提供商或模型名称 / ID（支持拼音）"
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

  <!-- 功能 Tab -->
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

  <!-- 能力多选 Chips -->
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
    </div>
  {/if}

  <!-- 筛选汇总行：左侧清除按钮（醒目），右侧统计 -->
  {#if searchStore.isFiltering}
    <div class="flex items-center justify-between animate-fade-in pt-1">
      <p class="text-xs text-muted-foreground">
        找到 {filteredProviderCount} 个提供商，{filteredModelCount} 个模型
      </p>
      <button
        type="button"
        class="flex items-center gap-1.5 rounded-lg border border-border/50 bg-background px-3 py-1.5 text-xs font-medium text-foreground shadow-sm transition-all duration-200 hover:bg-muted hover:border-border hover:shadow"
        onclick={() => searchStore.clearAllFilters()}
      >
        <IconFilterOff size={13} stroke={1.5} />
        清除全部筛选
      </button>
    </div>
  {/if}
</div>
