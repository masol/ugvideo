<script lang="ts">
  import { Button } from "$lib/components/ui/button";
  import {
    IconFilterOff,
    IconPlus,
    IconWorldSearch,
  } from "@tabler/icons-svelte";

  let {
    variant = "empty",
    onAction,
  }: {
    variant?: "empty" | "filtered";
    onAction?: () => void;
  } = $props();
</script>

<div
  class="flex animate-fade-in flex-col items-center justify-center space-y-6 py-24"
>
  <div class="flex size-16 items-center justify-center rounded-2xl bg-muted">
    <IconWorldSearch size={24} stroke={1.5} class="text-muted-foreground" />
  </div>
  <div class="space-y-2 text-center">
    {#if variant === "empty"}
      <h3 class="text-lg font-medium">尚未配置搜索后端</h3>
      <p class="text-sm text-muted-foreground">
        添加搜索引擎（如 Tavily、Brave）以启用联网能力
      </p>
    {:else}
      <h3 class="text-lg font-medium">未找到匹配的搜索后端</h3>
      <p class="text-sm text-muted-foreground">
        尝试更换搜索关键词或调整筛选条件
      </p>
    {/if}
  </div>
  <Button class="gap-2 rounded-xl" onclick={() => onAction?.()}>
    {#if variant === "empty"}
      <IconPlus size={16} stroke={1.5} />
      添加后端
    {:else}
      <IconFilterOff size={16} stroke={1.5} />
      清除全部筛选
    {/if}
  </Button>
</div>
