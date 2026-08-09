<script lang="ts">
  import { Button } from "$lib/components/ui/button";
  import * as Popover from "$lib/components/ui/popover";
  import { IconBolt, IconPlus, IconWorldSearch } from "@tabler/icons-svelte";
  import { searchStore } from "./searchstore.svelte";

  let {
    providerCount = 0,
    enabledProviders = 0,
    onAdd,
  }: {
    providerCount?: number;
    enabledProviders?: number;
    onAdd?: (type: import("./types").SerpProviderType) => void;
  } = $props();

  let query = $state("");
  let open = $state(false);

  let results = $derived(searchStore.searchAvailable(query));

  function pick(type: import("./types").SerpProviderType) {
    onAdd?.(type);
    open = false;
    query = "";
  }

  let canAdd = $derived(searchStore.availableTypes.length > 0);
</script>

<header class="flex flex-col gap-6 sm:flex-row sm:items-end sm:justify-between">
  <div class="space-y-2">
    <h1 class="text-2xl font-semibold tracking-tight lg:text-3xl">搜索增强</h1>
    <p class="text-sm text-muted-foreground">管理 SERP 搜索后端</p>
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
    </div>
  </div>

  <Popover.Root bind:open>
    <Popover.Trigger>
      {#snippet child({ props })}
        <Button
          {...props}
          class="gap-2 self-start rounded-xl sm:self-auto"
          disabled={!canAdd}
        >
          <IconPlus size={16} stroke={1.5} />
          添加后端
        </Button>
      {/snippet}
    </Popover.Trigger>
    <Popover.Content class="w-72 rounded-xl p-2" align="end">
      <input
        type="text"
        bind:value={query}
        placeholder="搜索提供商…"
        class="w-full rounded-lg border border-border/50 bg-background px-3 py-2 text-sm outline-none transition-all duration-200 placeholder:text-muted-foreground focus:border-primary/50"
      />
      <div class="mt-2 max-h-64 overflow-y-auto">
        {#each results as r (r.type)}
          <button
            type="button"
            class="flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-sm transition-all duration-200 hover:bg-muted"
            onclick={() => pick(r.type)}
          >
            <span>{r.name}</span>
            <span class="font-mono text-xs text-muted-foreground">{r.type}</span>
          </button>
        {:else}
          <p class="px-3 py-6 text-center text-xs text-muted-foreground">
            {query ? "无匹配结果" : "已添加全部提供商"}
          </p>
        {/each}
      </div>
    </Popover.Content>
  </Popover.Root>
</header>