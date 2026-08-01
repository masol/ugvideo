<script lang="ts">
  import { Button } from "$lib/components/ui/button";
  import {
    IconBolt,
    IconPlus,
    IconSearch,
    IconWorldSearch,
  } from "@tabler/icons-svelte";

  let {
    providerCount = 0,
    enabledProviders = 0,
    engineCount = 0,
    enabledEngines = 0,
    onAddProvider,
  }: {
    providerCount?: number;
    enabledProviders?: number;
    engineCount?: number;
    enabledEngines?: number;
    onAddProvider?: () => void;
  } = $props();
</script>

<header class="flex flex-col gap-6 sm:flex-row sm:items-end sm:justify-between">
  <div class="space-y-2">
    <h1 class="text-2xl font-semibold tracking-tight lg:text-3xl">搜索增强</h1>
    <p class="text-sm text-muted-foreground">管理搜索引擎后端与领域过滤策略</p>
    <div
      class="flex flex-wrap items-center gap-3 pt-1 text-xs text-muted-foreground"
    >
      <span class="flex items-center gap-1.5">
        <IconWorldSearch size={14} stroke={1.5} />
        {providerCount} 个后端
      </span>
      <span class="text-border">·</span>
      <span class="flex items-center gap-1.5">
        <IconBolt size={14} stroke={1.5} />
        {enabledProviders} 个启用
      </span>
      <span class="text-border">·</span>
      <span class="flex items-center gap-1.5">
        <IconSearch size={14} stroke={1.5} />
        {engineCount} 个引擎（{enabledEngines} 启用）
      </span>
    </div>
  </div>
  <Button
    class="gap-2 self-start rounded-xl sm:self-auto"
    onclick={() => onAddProvider?.()}
  >
    <IconPlus size={16} stroke={1.5} />
    添加后端
  </Button>
</header>
