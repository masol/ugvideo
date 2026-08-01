<script lang="ts">
  import { Input } from "$lib/components/ui/input";
  import { IconFilterOff, IconSearch, IconX } from "@tabler/icons-svelte";
  import { mcpStore } from "./mcpstore.svelte";

  let {
    filteredServerCount = 0,
  }: {
    filteredServerCount?: number;
  } = $props();

  const TRANSPORTS = [
    { value: "stdio", label: "本地 (stdio)" },
    { value: "sse", label: "SSE" },
    { value: "http", label: "HTTP" },
  ] as const;
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
      bind:value={mcpStore.searchQuery}
      placeholder="搜索服务名、ID 或描述…"
      class="rounded-xl pl-9 pr-9"
    />
    {#if mcpStore.searchQuery}
      <button
        class="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground transition-colors duration-200 hover:text-foreground"
        onclick={() => (mcpStore.searchQuery = "")}
        type="button"
        aria-label="清除搜索"
      >
        <IconX size={14} stroke={1.5} />
      </button>
    {/if}
  </div>

  <!-- 传输协议 + 仅显示启用 -->
  <div class="flex flex-wrap items-center gap-2">
    <span class="mr-1 text-xs text-muted-foreground">传输协议</span>
    {#each TRANSPORTS as t (t.value)}
      {@const active = mcpStore.transportFilters.includes(t.value)}
      <button
        type="button"
        aria-pressed={active}
        class={[
          "flex cursor-pointer items-center gap-1.5 rounded-lg border px-2.5 py-1 text-xs transition-all duration-200",
          active
            ? "border-primary/50 bg-primary/10 text-primary"
            : "border-border/50 bg-background text-muted-foreground hover:bg-muted",
        ]}
        onclick={() => mcpStore.toggleTransportFilter(t.value)}
      >
        {t.label}
      </button>
    {/each}

    <button
      type="button"
      aria-pressed={mcpStore.showOnlyEnabled}
      class={[
        "ml-2 flex cursor-pointer items-center gap-1.5 rounded-lg border px-2.5 py-1 text-xs transition-all duration-200",
        mcpStore.showOnlyEnabled
          ? "border-primary/50 bg-primary/10 text-primary"
          : "border-border/50 bg-background text-muted-foreground hover:bg-muted",
      ]}
      onclick={() => mcpStore.toggleShowOnlyEnabled()}
    >
      仅显示已启用
    </button>

    {#if mcpStore.isFiltering}
      <button
        type="button"
        class="ml-1 flex cursor-pointer items-center gap-1 rounded-lg px-2 py-1 text-xs text-muted-foreground transition-colors duration-200 hover:text-foreground"
        onclick={() => mcpStore.clearAllFilters()}
      >
        <IconFilterOff size={12} stroke={1.5} />
        清除
      </button>
    {/if}
  </div>

  {#if mcpStore.isFiltering}
    <p class="animate-fade-in text-xs text-muted-foreground">
      找到 {filteredServerCount} 个 MCP 服务
    </p>
  {/if}
</div>
