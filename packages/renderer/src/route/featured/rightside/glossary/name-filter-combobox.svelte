<!-- $lib/components/glossary/name-filter-combobox.svelte -->
<!--
  术语名称过滤 Combobox：
    - 本质是一个「可搜索输入框」：Command.Input 里输入的任意文本会实时提交为过滤值
      （开放搜索，不强制选择候选项）。
    - 候选项带描述（value + desc），描述同样纳入拼音 / 首字母 / 模糊匹配。
    - 选中候选项 → 立即以该 value 提交并关闭弹层。
  与父组件通信：
    - value：当前已提交的过滤文本（受控）。
    - onInput(text)：每次键入触发（父组件负责防抖 → setName）。
    - onCommit(text)：选中候选项 / 需要立即生效时触发（父组件取消防抖后直接 setName）。
-->
<script lang="ts">
  import * as Command from "$lib/components/ui/command/index.js";
  import * as Popover from "$lib/components/ui/popover/index.js";
  import { cn } from "$lib/utils";
  import { PinyinFuseSearch, type SearchItem } from "$lib/utils/fuse";
  import type { BlueprintFilterOption } from "@app/main/types";
  import { IconCheck, IconSearch } from "@tabler/icons-svelte";

  let {
    value = "",
    options = [],
    placeholder = "按名称过滤…",
    onInput,
    onCommit,
  }: {
    value?: string;
    options?: BlueprintFilterOption[];
    placeholder?: string;
    onInput?: (text: string) => void;
    onCommit?: (text: string) => void;
  } = $props();

  let open = $state(false);
  let triggerWidth = $state(0);
  let triggerHeight = $state(40);
  // query 是弹层内搜索框的实时文本；与已提交的 value 解耦。
  let query = $state(value);

  // 打开时用当前已提交的 value 初始化 query，保证视图连续（不清空过滤）。
  $effect(() => {
    if (open) query = value;
  });

  // ── 拼音搜索器：text = "value desc"，让描述也可被搜到 ──
  // options 为项目级静态数据，重建成本可忽略；随 kind 切换自动重算。
  const fuse = $derived.by(() => {
    const items: SearchItem[] = options.map((o) => ({
      id: o.value,
      text: o.desc ? `${o.value} ${o.desc}` : o.value,
    }));
    return new PinyinFuseSearch(items, { threshold: 0.4 });
  });

  // value → option 反查表，用于把 fuse 命中的 id 还原为带描述的候选项。
  const byValue = $derived(new Map(options.map((o) => [o.value, o])));

  /**
   * query 为空 → 展示全量候选；非空 → 拼音模糊搜索命中的候选（按相关度）。
   */
  const results = $derived.by<BlueprintFilterOption[]>(() => {
    const q = query.trim();
    if (!q) return options;
    return fuse
      .search(q)
      .map((id) => byValue.get(String(id)))
      .filter((o): o is BlueprintFilterOption => !!o);
  });

  // 键入：实时把 query 提交为过滤值（开放搜索），父组件负责防抖。
  function handleQuery(next: string) {
    query = next;
    onInput?.(next);
  }

  // 选中候选：立即提交并关闭。
  function pick(v: string) {
    query = v;
    onCommit?.(v);
    open = false;
  }
</script>

<div
  class="relative w-full"
  bind:clientWidth={triggerWidth}
  bind:clientHeight={triggerHeight}
>
  <Popover.Root bind:open>
    <Popover.Trigger>
      {#snippet child({ props })}
        <button
          {...props}
          type="button"
          class={cn(
            "flex h-10 w-full items-center gap-3 rounded-xl border border-input bg-background px-3 text-sm",
            "transition-all duration-200 hover:bg-accent/30",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
            // 打开时隐藏 trigger，让弹层无缝接管该位置，避免"两个相似控件"困扰。
            open && "pointer-events-none opacity-0",
          )}
        >
          <IconSearch
            size={20}
            stroke={1.5}
            class="size-4 shrink-0 text-muted-foreground"
          />
          {#if value.trim()}
            <span class="min-w-0 flex-1 truncate text-left text-foreground">
              {value}
            </span>
          {:else}
            <span
              class="min-w-0 flex-1 truncate text-left text-muted-foreground"
            >
              {placeholder}
            </span>
          {/if}
        </button>
      {/snippet}
    </Popover.Trigger>

    <!--
      side="bottom" + sideOffset={-triggerHeight}
      → 弹层从 trigger 顶部起向下展开，完整覆盖原按钮。
    -->
    <Popover.Content
      class={cn(
        "overflow-hidden rounded-xl border border-border/60 bg-popover p-0 shadow-xl",
        "animate-fade-in",
      )}
      align="start"
      side="bottom"
      sideOffset={-triggerHeight}
      style="width: {triggerWidth}px; z-index: 9999;"
    >
      <!-- shouldFilter=false：改由拼音模糊搜索自行过滤与排序 -->
      <Command.Root class="rounded-xl" shouldFilter={false}>
        <Command.Input
          value={query}
          oninput={(e) => handleQuery(e.currentTarget.value)}
          placeholder="输入名称 / 拼音 / 首字母搜索（也可直接作为过滤词）…"
          class="h-10"
        />
        <Command.List class="max-h-72">
          {#if results.length > 0}
            <Command.Group heading={query.trim() ? "搜索结果" : "候选项"}>
              {#each results as opt (opt.value)}
                <Command.Item
                  value={opt.value}
                  onSelect={() => pick(opt.value)}
                >
                  <div class="min-w-0 flex-1 space-y-0.5">
                    <p class="truncate text-sm font-medium">{opt.value}</p>
                    {#if opt.desc}
                      <p class="truncate text-xs text-muted-foreground">
                        {opt.desc}
                      </p>
                    {/if}
                  </div>
                  {#if value === opt.value}
                    <IconCheck
                      size={20}
                      stroke={1.5}
                      class="ml-auto size-4 shrink-0 text-primary"
                    />
                  {/if}
                </Command.Item>
              {/each}
            </Command.Group>
          {:else}
            <div class="py-6 text-center text-sm text-muted-foreground">
              无匹配候选项 · 当前输入将作为过滤词生效
            </div>
          {/if}
        </Command.List>
      </Command.Root>
    </Popover.Content>
  </Popover.Root>
</div>
