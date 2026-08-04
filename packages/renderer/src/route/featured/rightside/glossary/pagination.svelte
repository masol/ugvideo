<!-- $lib/components/glossary/glossary-pagination.svelte -->
<script lang="ts">
  import { Button } from "$lib/components/ui/button/index.js";
  import { cn } from "$lib/utils";
  import {
    IconChevronLeft,
    IconChevronRight,
    IconChevronsLeft,
    IconChevronsRight,
  } from "@tabler/icons-svelte";
  import { blueprintStore } from "./store.svelte.js";

  /**
   * 当前页两侧最多各展开多少个数字按钮（含当前页）。
   * 例如 window=2 时，page=10 → 8 9 [10] 11 12。
   * 不直接暴露给 props，因为需求固定。
   */
  const WINDOW = 2;

  /**
   * 计算要渲染的页码序列（含首页 / 末页 / 省略号）。
   * 使用 null 表示一个 "..." 占位。
   */
  const pages = $derived.by<(number | "ellipsis")[]>(() => {
    const total = blueprintStore.pageCount;
    const cur = blueprintStore.pageIndex;
    if (total <= 1) return [0];

    const out: (number | "ellipsis")[] = [];
    const last = total - 1;

    const left = Math.max(1, cur - WINDOW);
    const right = Math.min(last - 1, cur + WINDOW);

    // 总是保留首页
    out.push(0);
    // 1 ... 的省略号
    if (left > 1) out.push("ellipsis");

    for (let p = left; p <= right; p++) out.push(p);

    // ... last 的省略号
    if (right < last - 1) out.push("ellipsis");
    // 总是保留末页
    if (last > 0) out.push(last);

    return out;
  });
</script>

<div class="flex items-center justify-between gap-4">
  <span class="text-xs text-muted-foreground tabular-nums">
    {#if blueprintStore.total > 0}
      第 {blueprintStore.pageIndex + 1} / {blueprintStore.pageCount} 页 · 共 {blueprintStore.total}
      条
    {:else}
      共 0 条
    {/if}
  </span>

  <div class="flex items-center gap-1.5">
    <!-- 首页 -->
    <Button
      variant="outline"
      size="icon"
      class="size-8 rounded-xl transition-all duration-200"
      onclick={() => blueprintStore.goToPage(0)}
      disabled={!blueprintStore.canPrev || blueprintStore.isLoading}
      aria-label="首页"
    >
      <IconChevronsLeft size={20} stroke={1.5} />
    </Button>
    <!-- 上一页 -->
    <Button
      variant="outline"
      size="icon"
      class="size-8 rounded-xl transition-all duration-200"
      onclick={() => blueprintStore.prevPage()}
      disabled={!blueprintStore.canPrev || blueprintStore.isLoading}
      aria-label="上一页"
    >
      <IconChevronLeft size={20} stroke={1.5} />
    </Button>

    {#if blueprintStore.pageCount > 0}
      <div class="flex items-center gap-1">
        {#each pages as p, i (i)}
          {#if p === "ellipsis"}
            <span class="px-1 text-xs text-muted-foreground select-none">…</span
            >
          {:else}
            <button
              type="button"
              class={cn(
                "inline-flex size-8 items-center justify-center rounded-xl text-xs font-medium tabular-nums transition-all duration-200",
                "border border-border/50",
                p === blueprintStore.pageIndex
                  ? "bg-primary text-primary-foreground shadow-sm"
                  : "bg-background text-muted-foreground hover:bg-accent/40 hover:text-foreground",
              )}
              aria-current={p === blueprintStore.pageIndex ? "page" : undefined}
              disabled={blueprintStore.isLoading}
              onclick={() => blueprintStore.goToPage(p)}
            >
              {p + 1}
            </button>
          {/if}
        {/each}
      </div>
    {/if}

    <!-- 下一页 -->
    <Button
      variant="outline"
      size="icon"
      class="size-8 rounded-xl transition-all duration-200"
      onclick={() => blueprintStore.nextPage()}
      disabled={!blueprintStore.canNext || blueprintStore.isLoading}
      aria-label="下一页"
    >
      <IconChevronRight size={20} stroke={1.5} />
    </Button>
    <!-- 末页 -->
    <Button
      variant="outline"
      size="icon"
      class="size-8 rounded-xl transition-all duration-200"
      onclick={() => blueprintStore.goToPage(blueprintStore.pageCount - 1)}
      disabled={!blueprintStore.canNext || blueprintStore.isLoading}
      aria-label="末页"
    >
      <IconChevronsRight size={20} stroke={1.5} />
    </Button>
  </div>
</div>
