<script lang="ts">
  import { Badge } from "$lib/components/ui/badge";
  import { Button } from "$lib/components/ui/button";
  import {
    IconCategory,
    IconClock,
    IconList,
    IconSettings,
    IconShield,
    IconTrash,
  } from "@tabler/icons-svelte";
  import type { SearchEngineConfig } from "./types";

  let {
    engine,
    disabled = false,
    onEdit,
    onRemove,
  }: {
    engine: SearchEngineConfig;
    disabled?: boolean;
    onEdit?: () => void;
    onRemove?: () => void;
  } = $props();

  const CATEGORY_LABELS: Record<SearchEngineConfig["category"], string> = {
    general: "通用",
    news: "新闻",
    academic: "学术",
    image: "图像",
    code: "代码",
  };
</script>

<div
  class={[
    "group flex items-center justify-between gap-3 rounded-xl border p-4 transition-all duration-200",
    disabled
      ? "pointer-events-none border-border/30 bg-muted/40 opacity-50"
      : "border-border/50 bg-background hover:border-border hover:shadow-sm",
  ]}
>
  <div class="min-w-0 space-y-1.5">
    <div class="flex flex-wrap items-center gap-2">
      <p class="truncate text-sm font-medium">{engine.label}</p>
      <Badge variant="secondary" class="gap-1 rounded-lg text-xs">
        <IconCategory size={12} stroke={1.5} />
        {CATEGORY_LABELS[engine.category]}
      </Badge>
      {#if !engine.enabled}
        <Badge
          variant="secondary"
          class="rounded-lg border-none bg-muted text-xs text-muted-foreground"
        >
          已禁用
        </Badge>
      {/if}
    </div>
    <div class="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
      <span class="flex items-center gap-1">
        <IconList size={12} stroke={1.5} />
        上限 {engine.maxResults}
      </span>
      <span class="flex items-center gap-1">
        <IconShield size={12} stroke={1.5} />
        {engine.safeSearch}
      </span>
      {#if engine.recencyDays}
        <span class="flex items-center gap-1">
          <IconClock size={12} stroke={1.5} />
          {engine.recencyDays} 天内
        </span>
      {/if}
    </div>
  </div>

  <div
    class="flex shrink-0 items-center gap-1 opacity-0 transition-all duration-200 group-hover:opacity-100 group-focus-within:opacity-100"
  >
    <Button
      variant="ghost"
      size="icon"
      class="size-7 rounded-lg text-muted-foreground hover:bg-accent hover:text-foreground"
      onclick={(e: MouseEvent) => {
        e.stopPropagation();
        onEdit?.();
      }}
    >
      <IconSettings size={14} stroke={1.5} />
    </Button>
    <Button
      variant="ghost"
      size="icon"
      class="size-7 rounded-lg text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
      onclick={(e: MouseEvent) => {
        e.stopPropagation();
        onRemove?.();
      }}
    >
      <IconTrash size={14} stroke={1.5} />
    </Button>
  </div>
</div>
