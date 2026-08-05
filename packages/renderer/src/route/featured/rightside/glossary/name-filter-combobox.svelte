<!-- $lib/components/glossary/name-filter-combobox.svelte -->
<script lang="ts">
  import * as Command from "$lib/components/ui/command/index.js";
  import * as Popover from "$lib/components/ui/popover/index.js";
  import { cn } from "$lib/utils";
  import { PinyinFuseSearch, type SearchItem } from "$lib/utils/fuse";
  import type { BlueprintFilterOption } from "@app/main/types";
  import { IconCheck, IconSearch, IconX } from "@tabler/icons-svelte";

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
  // svelte-ignore state_referenced_locally
  let query = $state(value); // 弹窗内的实时文本
  // svelte-ignore state_referenced_locally
  let localInput = $state(value); // 纯 input 模式下的文本
  let triggerInputEl = $state<HTMLInputElement | null>(null);
  let triggerWidth = $state(0);
  let triggerHeight = $state(40);

  // 标记是否由 Escape 主动关闭（避免重复提交）
  let isEscaping = $state(false);
  // 阻止 ESC 后自动打开下拉的标志
  let suppressAutoOpen = $state(false);

  // ── 拼音搜索器 ──
  const fuse = $derived.by(() => {
    const items: SearchItem[] = options.map((o) => ({
      id: o.value,
      text: o.desc ? `${o.value} ${o.desc}` : o.value,
    }));
    return new PinyinFuseSearch(items, { threshold: 0.4 });
  });
  const byValue = $derived(new Map(options.map((o) => [o.value, o])));

  const results = $derived.by<BlueprintFilterOption[]>(() => {
    const q = query.trim();
    if (!q) return options;
    return fuse
      .search(q)
      .map((id) => byValue.get(String(id)))
      .filter((o): o is BlueprintFilterOption => !!o);
  });

  // 同步外部 value 到 localInput（仅在弹窗关闭时）
  $effect(() => {
    if (!open) localInput = value;
  });

  // 打开弹窗
  function openDropdown() {
    query = localInput;
    open = true;
  }

  // 关闭弹窗（统一入口，提交当前 query）
  function closeDropdown(opts?: { skipCommit?: boolean }) {
    const skip = opts?.skipCommit ?? false;
    open = false;

    if (!skip && query.trim() !== localInput.trim()) {
      localInput = query;
      onInput?.(query);
    }
    setTimeout(() => triggerInputEl?.focus(), 0);
  }

  function handleOpenChange(o: boolean) {
    if (!o) {
      // Escape 触发的关闭已手动处理，直接跳过
      if (isEscaping) {
        isEscaping = false;
        return;
      }
      closeDropdown();
    }
  }

  // ── 用户操作 ──
  function pick(v: string) {
    query = v;
    localInput = v;
    onCommit?.(v);
    open = false;
    setTimeout(() => triggerInputEl?.focus(), 0);
  }

  function handleEsc() {
    // Escape 不再取消：将当前下拉框内容提交到外部输入框并关闭
    localInput = query;
    onInput?.(query);
    isEscaping = true;
    open = false;
    suppressAutoOpen = true; // 关闭后防止下次点击自动弹出下拉
    setTimeout(() => triggerInputEl?.focus(), 0);
  }

  function handleClear(e?: Event) {
    e?.stopPropagation();
    query = "";
    localInput = "";
    onCommit?.("");
    open = false;
    suppressAutoOpen = false;
    setTimeout(() => triggerInputEl?.focus(), 0);
  }

  function handleInputKeydown(e: KeyboardEvent) {
    if (e.key === "Escape") {
      e.preventDefault();
      handleEsc();
    } else if (e.key === "Enter") {
      const q = query.trim();
      if (q) {
        const exact = options.find((o) => o.value === q);
        if (exact) return; // 交给 Command 处理
        e.preventDefault();
        pick(q);
      }
    }
  }

  // 纯 input 键盘事件
  function handleTriggerKeydown(e: KeyboardEvent) {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      suppressAutoOpen = false; // 明确手动打开下拉，重置标志
      openDropdown();
    }
  }

  // 点击 input 的行为：若被 ESC 抑制则不弹窗，否则弹窗
  function handleTriggerClick() {
    if (suppressAutoOpen) {
      suppressAutoOpen = false;
      return; // 仅聚焦，不打开下拉
    }
    openDropdown();
  }

  // 本地输入变化 – 实时触发搜索（父组件已做 debounce）
  function handleLocalInput(e: Event & { currentTarget: HTMLInputElement }) {
    localInput = e.currentTarget.value;
    onInput?.(localInput);
  }

  function handleLocalBlur() {
    if (localInput.trim() !== value.trim()) {
      onInput?.(localInput);
    }
  }

  function handleLocalKeydown(e: KeyboardEvent) {
    if (e.key === "Enter") {
      e.preventDefault();
      if (localInput.trim() !== value.trim()) {
        onInput?.(localInput);
      }
    } else if (e.key === "Escape") {
      localInput = value;
      (e.currentTarget as HTMLInputElement).blur();
    } else {
      handleTriggerKeydown(e); // 处理方向键
    }
  }
</script>

<div
  class="relative w-full"
  bind:clientWidth={triggerWidth}
  bind:clientHeight={triggerHeight}
>
  <Popover.Root {open} onOpenChange={handleOpenChange}>
    <Popover.Trigger>
      {#snippet child({ props })}
        <div class="relative w-full">
          <span
            class="pointer-events-none absolute inset-y-0 inset-s-0 flex items-center ps-3 text-muted-foreground"
          >
            <IconSearch size={20} stroke={1.5} class="size-4" />
          </span>
          <input
            {...props}
            bind:this={triggerInputEl}
            type="text"
            value={localInput}
            oninput={handleLocalInput}
            onclick={handleTriggerClick}
            onkeydown={handleLocalKeydown}
            onblur={handleLocalBlur}
            {placeholder}
            class={cn(
              "flex h-10 w-full rounded-xl border border-input bg-background ps-10 pe-8 text-sm",
              "transition-all duration-200 hover:bg-accent/30",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              open && "pointer-events-none opacity-0",
            )}
          />
          {#if localInput.trim()}
            <button
              type="button"
              class="absolute inset-y-0 inset-e-2 flex items-center text-muted-foreground hover:text-foreground"
              aria-label="清空搜索"
              onclick={handleClear}
            >
              <IconX size={20} stroke={1.5} class="size-4" />
            </button>
          {/if}
        </div>
      {/snippet}
    </Popover.Trigger>

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
      <Command.Root class="rounded-xl" shouldFilter={false}>
        <div class="relative">
          <Command.Input
            value={query}
            oninput={(e) => (query = e.currentTarget.value)}
            onkeydown={handleInputKeydown}
            placeholder="输入名称 / 拼音 / 首字母搜索…"
            class="h-10 pr-8"
          />
          {#if query.trim()}
            <button
              type="button"
              class="absolute right-2 top-1/2 -translate-y-1/2 rounded-md p-0.5 text-muted-foreground transition-colors hover:text-foreground"
              aria-label="清空搜索"
              onclick={handleClear}
            >
              <IconX size={20} stroke={1.5} class="size-4" />
            </button>
          {/if}
        </div>
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
