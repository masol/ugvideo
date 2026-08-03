<!-- ModelSelectCombobox.svelte -->
<script lang="ts">
  import * as Command from "$lib/components/ui/command";
  import * as Popover from "$lib/components/ui/popover";
  import { cn } from "$lib/utils";
  import type { ModelOption } from "$lib/utils/model/types";
  import {
    IconAlertTriangle,
    IconCheck,
    IconChevronDown,
    IconLoader2,
    IconSearch,
    IconX,
  } from "@tabler/icons-svelte";
  import { SvelteMap } from "svelte/reactivity";
  import { fetchAvailableModels } from "./fetchModels";

  type Props = {
    /**
     * 模型列表。可选：
     * · 显式传入 → 直接使用；
     * · 未传入（或为空数组）→ 组件内部自动调用 fetchAvailableModels 拉取并 cache。
     */
    options?: ModelOption[];
    /** fetch 上下文（当未显式传入 options 时使用） */
    fetchCtx?: { baseUrl?: string; apiKey?: string };
    selectedId?: string;
    loading?: boolean;
    failed?: boolean;
    onSelect?: (option: ModelOption) => void;
  };

  let {
    options: providedOptions,
    fetchCtx,
    selectedId = "",
    loading: loadingProp = false,
    failed: failedProp = false,
    onSelect,
  }: Props = $props();

  let open = $state(false);
  let triggerWidth = $state(0);

  // —— 内部 fetch 通路（仅在未显式传入 options 时启用） ——
  const hasExplicitOptions = $derived(
    providedOptions !== undefined && providedOptions.length > 0,
  );

  let fetchedOptions = $state<ModelOption[]>([]);
  let internalLoading = $state(false);
  let internalFailed = $state(false);

  $effect(() => {
    if (hasExplicitOptions) return; // 显式传入时跳过内部 fetch
    void loadInternal();
  });

  async function loadInternal() {
    internalLoading = true;
    internalFailed = false;
    try {
      fetchedOptions = await fetchAvailableModels(fetchCtx ?? {});
    } catch {
      internalFailed = true;
      fetchedOptions = [];
    } finally {
      internalLoading = false;
    }
  }

  // —— 统一暴露给模板的派生值 ——
  const options = $derived(
    hasExplicitOptions ? (providedOptions as ModelOption[]) : fetchedOptions,
  );
  const loading = $derived(hasExplicitOptions ? loadingProp : internalLoading);
  const failed = $derived(hasExplicitOptions ? failedProp : internalFailed);

  const selected = $derived(options.find((o) => o.id === selectedId) ?? null);

  /** 将扁平 options 按 group 分组（保持出现顺序） */
  const groups = $derived.by(() => {
    const map = new SvelteMap<string, ModelOption[]>();
    for (const o of options) {
      const g = o.group ?? "";
      if (!map.has(g)) map.set(g, []);
      map.get(g)!.push(o);
    }
    return [...map.entries()].map(([heading, items]) => ({ heading, items }));
  });

  function select(option: ModelOption) {
    onSelect?.(option);
    open = false;
  }

  /** 获取显示标签，优先使用 label，回退到 id */
  function getLabel(option: ModelOption): string {
    return option.label || option.id;
  }
</script>

<div bind:clientWidth={triggerWidth}>
  <Popover.Root bind:open>
    <Popover.Trigger disabled={loading}>
      {#snippet child({ props })}
        <button
          {...props}
          type="button"
          disabled={loading}
          class={cn(
            "flex h-10 w-full items-center gap-3 rounded-xl border border-input bg-background px-3 text-sm",
            "transition-all duration-200 hover:bg-accent/50",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
            "disabled:cursor-not-allowed disabled:opacity-60",
            open && "ring-2 ring-ring",
          )}
        >
          {#if loading}
            <IconLoader2
              size={16}
              stroke={1.5}
              class="shrink-0 animate-spin text-muted-foreground"
            />
          {:else if failed}
            <IconAlertTriangle
              size={16}
              stroke={1.5}
              class="shrink-0 text-amber-500"
            />
          {:else}
            <IconSearch
              size={16}
              stroke={1.5}
              class="shrink-0 text-muted-foreground"
            />
          {/if}

          {#if loading}
            <span class="min-w-0 flex-1 text-left text-muted-foreground">
              正在获取可用模型…
            </span>
          {:else if selected}
            <span class="min-w-0 flex-1 truncate text-left text-foreground">
              {getLabel(selected)}
            </span>
            {#if selected.description}
              <span class="shrink-0 truncate text-xs text-muted-foreground">
                {selected.description}
              </span>
            {/if}
          {:else if failed}
            <span class="min-w-0 flex-1 text-left text-muted-foreground">
              无法获取列表，可手动输入
            </span>
          {:else}
            <span class="min-w-0 flex-1 text-left text-muted-foreground">
              搜索并选择模型…
            </span>
          {/if}

          <IconChevronDown
            size={16}
            stroke={1.5}
            class={cn(
              "shrink-0 text-muted-foreground transition-transform duration-200",
              open && "rotate-180",
            )}
          />
        </button>
      {/snippet}
    </Popover.Trigger>

    <!--
      弹层完整覆盖触发按钮：
      · sideOffset={-40} 负偏移抵消触发器 h-10(40px) 高度，使弹层顶部与触发器顶部对齐 → 视觉上盖住触发按钮
      · 与触发器同宽，避免错位
      · Esc / 点击遮罩自动关闭（Popover 内建），无需回点触发按钮
    -->
    <Popover.Content
      class="overflow-hidden rounded-xl border border-border/50 p-0 shadow-xl"
      align="start"
      sideOffset={-40}
      style="width: {triggerWidth}px; z-index: 9999;"
    >
      <Command.Root>
        <!-- 搜索栏 + 显式关闭按钮 -->
        <div class="relative">
          <Command.Input placeholder="输入模型名称搜索…" class="pr-10" />
          <button
            type="button"
            onclick={() => (open = false)}
            aria-label="关闭"
            class={cn(
              "absolute right-2 top-1/2 -translate-y-1/2 rounded-lg p-1",
              "text-muted-foreground transition-all duration-200 hover:bg-muted hover:text-foreground",
            )}
          >
            <IconX size={16} stroke={1.5} />
          </button>
        </div>

        <Command.List class="max-h-72">
          <Command.Empty>未找到匹配的模型</Command.Empty>

          {#each groups as group (group.heading)}
            <Command.Group heading={group.heading || undefined}>
              {#each group.items as option (option.id)}
                <Command.Item
                  value={option.id}
                  keywords={[getLabel(option), option.description ?? ""]}
                  onSelect={() => select(option)}
                >
                  <div class="min-w-0 flex-1 space-y-0.5">
                    <p class="truncate text-sm font-medium">
                      {getLabel(option)}
                    </p>
                    {#if option.description}
                      <p class="truncate text-xs text-muted-foreground">
                        {option.description}
                      </p>
                    {/if}
                  </div>
                  {#if selectedId === option.id}
                    <IconCheck
                      size={16}
                      stroke={1.5}
                      class="ml-auto shrink-0 text-primary"
                    />
                  {/if}
                </Command.Item>
              {/each}
            </Command.Group>
            {#if group !== groups[groups.length - 1]}
              <Command.Separator />
            {/if}
          {/each}
        </Command.List>
      </Command.Root>
    </Popover.Content>
  </Popover.Root>
</div>
