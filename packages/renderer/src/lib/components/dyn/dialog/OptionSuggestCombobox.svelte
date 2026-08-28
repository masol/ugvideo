<!--
  ╭─────────────────────────────────────────────────────╮
  │ [内联片段选择器 → OptionSuggestCombobox.svelte]       │
  │ 职责：点击按钮后在当前位置内联展开搜索选择面板       │
  │ 无 Popover / Portal，避免 Dialog 内 z-index 冲突     │
  │ 契约：                                                │
  │   - options: string[] 完整原始字符串数组             │
  │   - onSelect(value: string) 选中后回传完整原始值     │
  │   - onOpenChange(open) 供父组件在打开瞬间快照光标    │
  ╰─────────────────────────────────────────────────────╯
-->
<script lang="ts">
  import { ScrollArea } from "$lib/components/ui/scroll-area";
  import {
    IconChevronDown,
    IconSearch,
    IconSparkles,
  } from "@tabler/icons-svelte";
  import { tick } from "svelte";
  import { slide } from "svelte/transition";

  type Props = {
    options: string[];
    onSelect: (value: string) => void;
    onOpenChange?: (open: boolean) => void;
  };

  let { options, onSelect, onOpenChange }: Props = $props();

  let open = $state(false);
  let query = $state("");
  let selectedIndex = $state(0);
  let inputEl: HTMLInputElement | undefined = $state();

  const filtered = $derived.by(() => {
    const q = query.trim().toLowerCase();
    if (!q) return options;
    return options.filter((o) => o.toLowerCase().includes(q));
  });

  $effect(() => {
    // 搜索结果变化时重置选中索引
    void filtered;
    selectedIndex = 0;
  });

  async function toggle() {
    open = !open;
    onOpenChange?.(open);
    if (open) {
      query = "";
      selectedIndex = 0;
      await tick();
      inputEl?.focus();
    }
  }

  function handleSelect(value: string) {
    onSelect(value);
    open = false;
    onOpenChange?.(false);
    query = "";
  }

  function handleKeydown(e: KeyboardEvent) {
    if (!open) return;

    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      open = false;
      onOpenChange?.(false);
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      selectedIndex = Math.min(selectedIndex + 1, filtered.length - 1);
      scrollToSelected();
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      selectedIndex = Math.max(selectedIndex - 1, 0);
      scrollToSelected();
    } else if (e.key === "Enter") {
      e.preventDefault();
      const item = filtered[selectedIndex];
      if (item) handleSelect(item);
    }
  }

  function scrollToSelected() {
    requestAnimationFrame(() => {
      document
        .querySelector(`[data-option-index="${selectedIndex}"]`)
        ?.scrollIntoView({ block: "nearest" });
    });
  }
</script>

<div class="relative">
  <!-- 触发按钮 -->
  <button
    type="button"
    onclick={toggle}
    aria-label="插入预设片段"
    aria-expanded={open}
    class="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-xl border border-border/50 bg-background px-2.5 text-xs font-medium text-muted-foreground transition-all duration-200 hover:border-primary/50 hover:bg-accent hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
  >
    <IconSparkles size={14} stroke={1.5} />
    <span>插入片段</span>
    <IconChevronDown
      size={12}
      stroke={1.5}
      class="transition-transform duration-200 {open ? 'rotate-180' : ''}"
    />
  </button>

  <!-- 内联展开面板 -->
  {#if open}
    <!-- svelte-ignore a11y_interactive_supports_focus -->
    <div
      transition:slide={{ duration: 200 }}
      class="absolute right-0 top-full z-50 mt-2 w-80 overflow-hidden rounded-xl border border-border/50 bg-popover shadow-xl"
      onkeydown={handleKeydown}
      role="listbox"
    >
      <!-- 搜索栏 -->
      <div
        class="flex items-center gap-2 border-b border-border/50 bg-muted/30 px-3 py-2"
      >
        <IconSearch size={14} stroke={1.5} class="text-muted-foreground" />
        <input
          bind:this={inputEl}
          bind:value={query}
          type="text"
          placeholder="搜索片段…"
          autocomplete="off"
          spellcheck="false"
          class="flex-1 bg-transparent text-xs outline-none placeholder:text-muted-foreground"
        />
        <span class="text-[10px] text-muted-foreground">
          {filtered.length}
        </span>
      </div>

      <!-- 选项列表 -->
      <ScrollArea class="max-h-56">
        <div class="p-1.5">
          {#if filtered.length === 0}
            <div class="py-6 text-center text-xs text-muted-foreground">
              未找到匹配片段
            </div>
          {:else}
            <ul class="space-y-0.5" role="listbox">
              {#each filtered as opt, i (i + "::" + opt)}
                {@const isSelected = i === selectedIndex}
                <li>
                  <button
                    type="button"
                    data-option-index={i}
                    onclick={() => handleSelect(opt)}
                    onmouseenter={() => (selectedIndex = i)}
                    title={opt}
                    class="flex w-full items-start rounded-lg px-2.5 py-2 text-left text-xs transition-colors duration-200 {isSelected
                      ? 'bg-primary/10 text-foreground'
                      : 'text-foreground hover:bg-muted'}"
                    role="option"
                    aria-selected={isSelected}
                  >
                    <span class="min-w-0 flex-1 truncate font-medium">
                      {opt}
                    </span>
                  </button>
                </li>
              {/each}
            </ul>
          {/if}
        </div>
      </ScrollArea>

      <!-- 底部快捷键提示 -->
      <div
        class="flex items-center gap-2 border-t border-border/50 bg-muted/30 px-3 py-1.5 text-[10px] text-muted-foreground"
      >
        <span>↑↓ 导航</span>
        <span>↵ 选择</span>
        <span>Esc 关闭</span>
      </div>
    </div>
  {/if}
</div>
