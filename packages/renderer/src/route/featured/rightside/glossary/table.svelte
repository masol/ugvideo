<!-- $lib/components/glossary/glossary-table.svelte -->
<script lang="ts">
  import {
    createSvelteTable,
    FlexRender,
  } from "$lib/components/ui/data-table/index.js";
  import { Skeleton } from "$lib/components/ui/skeleton/index.js";
  import * as Table from "$lib/components/ui/table/index.js";
  import { getCoreRowModel } from "@tanstack/table-core";

  import { projectStore } from "$lib/store/project.svelte";
  import { cn } from "$lib/utils";
  import {
    IconArrowDown,
    IconArrowsSort,
    IconArrowUp,
    IconFolderOpen,
    IconMoodEmpty,
  } from "@tabler/icons-svelte";
  import { glossaryColumns } from "./columns.js";
  import GlossaryPagination from "./pagination.svelte";
  import { blueprintStore, type BlueprintSortBy } from "./store.svelte.js";
  import GlossaryToolbar from "./toolbar.svelte";

  const hasProject = $derived((projectStore.path?.length ?? 0) > 0);

  $effect(() => {
    if (hasProject) {
      blueprintStore.load();
    }
  });

  const table = createSvelteTable({
    get data() {
      return blueprintStore.items;
    },
    columns: glossaryColumns,
    getRowId: (row) => row.name,
    getCoreRowModel: getCoreRowModel(),
  });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  function cellClass(column: any): string {
    return (column.columnDef.meta?.class as string | undefined) ?? "";
  }

  /**
   * 排序图标：根据当前是否激活 / 方向选择渲染哪一个。
   * - 未激活（该列不是当前排序键）→ 淡色双箭头（提示该列可排序）
   * - 激活 + asc → 上箭头
   * - 激活 + desc → 下箭头
   */
  function sortIconFor(sortable: BlueprintSortBy) {
    const active = blueprintStore.sortBy === sortable;
    if (!active) return IconArrowsSort;
    return blueprintStore.sortOrder === "asc" ? IconArrowUp : IconArrowDown;
  }

  function sortLabelFor(sortable: BlueprintSortBy, headerLabel: string) {
    const active = blueprintStore.sortBy === sortable;
    if (!active) return `按${headerLabel}排序`;
    const dir = blueprintStore.sortOrder === "asc" ? "升序" : "降序";
    return `当前按${headerLabel}${dir}，再次点击切换方向`;
  }
</script>

<div class="flex h-full w-full flex-col gap-6">
  {#if !hasProject}
    <!--╭─────────────────────────────────────────────────────╮ -->
    <!-- │ [可抽取子组件 → glossary-empty-state.svelte]         │ -->
    <!-- │ 职责：未打开项目时的引导占位（术语/元术语/能力表通用）│ -->
    <!-- ╰─────────────────────────────────────────────────────╯ -->
    <div
      class="flex h-full flex-1 flex-col items-center justify-center gap-4 rounded-2xl border border-border/50 p-12 text-center animate-fade-in"
    >
      <span
        class="flex size-16 items-center justify-center rounded-2xl bg-muted text-muted-foreground"
      >
        <IconFolderOpen size={24} stroke={1.5} />
      </span>
      <div class="space-y-2">
        <h3 class="text-lg font-medium">尚未打开项目</h3>
        <p class="max-w-sm text-sm text-muted-foreground">
          蓝图内容（术语表、元术语表以及能力表）需要在打开项目后才可查阅与编辑。
        </p>
        <p class="text-xs text-muted-foreground">
          请先在主控制台打开一个项目，然后返回此处继续。
        </p>
      </div>
    </div>
    <!-- ╭─── / glossary-empty-state ───╮ -->
  {:else}
    <!--╭─────────────────────────────────────────────────────╮ -->
    <!-- │ [可抽取子组件 → glossary-toolbar.svelte]             │ -->
    <!-- │ 职责：蓝图切换、新建按钮、名称过滤                    │ -->
    <!-- ╰─────────────────────────────────────────────────────╯ -->
    <GlossaryToolbar />
    <!-- ╭─── / glossary-toolbar ───╮ -->

    <!--╭─────────────────────────────────────────────────────╮ -->
    <!-- │ [数据区：加载态 / 空态 / 表格三态切换]                │ -->
    <!-- ╰─────────────────────────────────────────────────────╯ -->
    <div class="flex-1 overflow-hidden rounded-2xl border border-border/50">
      {#if blueprintStore.isLoading}
        <div class="space-y-3 p-6">
          {#each Array(blueprintStore.pageSize) as _, i (i)}
            <div class="flex items-center gap-3">
              <Skeleton class="h-4 flex-1 rounded-xl" />
              <Skeleton class="h-4 w-16 rounded-xl" />
              <Skeleton class="size-8 rounded-lg" />
            </div>
          {/each}
        </div>
      {:else if blueprintStore.error}
        <div
          class="flex h-full flex-col items-center justify-center gap-2 p-8 text-center animate-fade-in"
        >
          <p class="text-sm font-medium text-destructive">
            {blueprintStore.error}
          </p>
          <p class="text-xs text-muted-foreground">请稍后重试。</p>
        </div>
      {:else if blueprintStore.items.length === 0}
        <div
          class="flex h-full flex-col items-center justify-center gap-3 p-8 text-center animate-fade-in"
        >
          <span class="text-muted-foreground">
            <IconMoodEmpty size={24} stroke={1.5} />
          </span>
          <p class="text-sm text-muted-foreground">暂无匹配的条目</p>
        </div>
      {:else}
        <div class="animate-fade-in w-full overflow-hidden">
          <Table.Root class="w-full table-auto">
            <Table.Header>
              {#each table.getHeaderGroups() as headerGroup (headerGroup.id)}
                <Table.Row class="border-border/50 hover:bg-transparent">
                  {#each headerGroup.headers as header (header.id)}
                    <!-- eslint-disable-next-line @typescript-eslint/no-explicit-any -->
                    {@const sortable = (header.column.columnDef.meta as any)
                      ?.sortable as BlueprintSortBy | undefined}
                    <Table.Head
                      class={[
                        "h-10 px-4 text-xs font-medium text-muted-foreground",
                        cellClass(header.column),
                      ]}
                    >
                      {#if !header.isPlaceholder}
                        {#if sortable}
                          <!--
                            该列可排序 → 渲染排序按钮：
                              - 未激活显示 IconArrowsSort（双箭头，提示可排）
                              - 激活后根据方向显示向上/向下箭头
                            点按行为：store.setSortBy(...) 统一处理"切键 / 翻方向"。
                          -->
                          {@const SortIcon = sortIconFor(sortable)}
                          {@const active = blueprintStore.sortBy === sortable}
                          <button
                            type="button"
                            class={cn(
                              "inline-flex w-full items-center gap-1.5 rounded-md px-2 py-0.5 transition-all duration-200",
                              "cursor-pointer hover:bg-muted hover:text-foreground",
                              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                              active ? "text-primary" : "text-muted-foreground",
                              cellClass(header.column).includes("text-end")
                                ? "justify-end"
                                : "justify-start",
                            )}
                            aria-label={sortLabelFor(
                              sortable,
                              header.column.columnDef.header as string,
                            )}
                            onclick={() => blueprintStore.setSortBy(sortable)}
                          >
                            <span class="text-xs font-medium">
                              {header.column.columnDef.header}
                            </span>
                            <SortIcon
                              size={14}
                              stroke={1.5}
                              class={cn("shrink-0", !active && "opacity-50")}
                            />
                          </button>
                        {:else}
                          <!-- 不可排序列（actions） → 普通表头文本 -->
                          <FlexRender
                            content={header.column.columnDef.header}
                            context={header.getContext()}
                          />
                        {/if}
                      {/if}
                    </Table.Head>
                  {/each}
                </Table.Row>
              {/each}
            </Table.Header>
            <Table.Body>
              {#each table.getRowModel().rows as row (row.id)}
                <Table.Row
                  class="border-border/50 transition-all duration-200 hover:bg-muted/50"
                >
                  {#each row.getVisibleCells() as cell (cell.id)}
                    <Table.Cell class={["px-4 py-3", cellClass(cell.column)]}>
                      <FlexRender
                        content={cell.column.columnDef.cell}
                        context={cell.getContext()}
                      />
                    </Table.Cell>
                  {/each}
                </Table.Row>
              {/each}
            </Table.Body>
          </Table.Root>
        </div>
      {/if}
    </div>
    <!-- ╭─── / 数据区 ───╮ -->

    <!--╭─────────────────────────────────────────────────────╮ -->
    <!-- │ [可抽取子组件 → glossary-pagination.svelte]          │ -->
    <!-- ╰─────────────────────────────────────────────────────╯ -->
    <GlossaryPagination />
    <!-- ╭─── / glossary-pagination ───╮ -->
  {/if}
</div>
