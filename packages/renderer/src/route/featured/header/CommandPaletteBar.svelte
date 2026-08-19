<!-- CommandPaletteBar.svelte -->
<script lang="ts">
  import { configStore } from "$lib/store/config.svelte";
  import { projectStore } from "$lib/store/project.svelte";
  import { commandCenter } from "$lib/utils/commands/center";
  import { PinyinFuseSearch } from "$lib/utils/fuse";
  import {
    IconArrowDown,
    IconArrowLeft,
    IconArrowRight,
    IconArrowUp,
    IconChevronRight,
    IconCornerDownLeft,
    IconHome2,
    IconSearch,
  } from "@tabler/icons-svelte";
  import hotkeys from "hotkeys-js";
  import { debounce } from "radashi";
  import { onDestroy, onMount, tick } from "svelte";
  import { push, router } from "svelte-spa-router";
  import { quintOut } from "svelte/easing";
  import { fade, scale } from "svelte/transition";

  interface CommandEntry {
    id: string;
    label: string;
    category: string;
    description: string;
  }

  let isOpen = $state(false);
  let query = $state("");
  let title = $derived(projectStore.path || "unigen");
  let selectedIndex = $state(0);
  let inputEl: HTMLInputElement | undefined = $state();

  const currentLocation = $derived(router.location);
  const isNotHome = $derived(currentLocation !== "/");

  // 使用 Navigation API 管理导航状态
  let canGoBack = $state(false);
  let canGoForward = $state(false);

  function updateNavState() {
    canGoBack = navigation.canGoBack;
    canGoForward = navigation.canGoForward;
  }

  // ---------- 命令搜索 ----------
  const allCommands = $derived(
    commandCenter.getAllDescriptors() as CommandEntry[],
  );

  const fuseSearch = $derived.by(() => {
    const items = allCommands.map((c) => ({
      id: c.id,
      text: [c.label, c.description, c.category, c.id]
        .filter(Boolean)
        .join(" "),
    }));
    return new PinyinFuseSearch(items, {
      keys: [
        { name: "text", weight: 1.0 },
        { name: "_fullPinyin", weight: 0.5 },
        { name: "_firstLetters", weight: 0.3 },
      ],
      threshold: 0.3,
    });
  });

  let debouncedQuery = $state("");
  const applyDebouncedQuery = debounce({ delay: 150 }, (q: string) => {
    debouncedQuery = q;
  });

  $effect(() => {
    applyDebouncedQuery(query);
    return () => applyDebouncedQuery.cancel();
  });

  const filtered = $derived.by(() => {
    const q = debouncedQuery.trim();
    if (!q) return allCommands;
    const ids = new Set(fuseSearch.search(q));
    return allCommands.filter((c) => ids.has(c.id));
  });

  const grouped = $derived.by(() => {
    const groups: Record<string, CommandEntry[]> = {};
    for (const cmd of filtered) {
      const cat = cmd.category || "(Uncategorized)";
      if (!groups[cat]) groups[cat] = [];
      groups[cat].push(cmd);
    }
    return groups;
  });

  const flatList = $derived.by(() => {
    const result: CommandEntry[] = [];
    for (const cat of Object.keys(grouped)) result.push(...grouped[cat]);
    return result;
  });

  const categories = $derived(Object.keys(grouped));

  function getHotkeyForCommand(id: string): string | null {
    return configStore.keybinding.getHotkeyForCommand(id) ?? null;
  }

  // ---------- 命令面板控制 ----------
  async function focusInputRobustly(maxRetries = 25) {
    await tick();
    for (let i = 0; i < maxRetries; i++) {
      if (!isOpen) return;
      if (!inputEl) {
        await new Promise((r) => requestAnimationFrame(r));
        continue;
      }
      inputEl.focus();
      if (document.activeElement === inputEl) return;
      await new Promise((r) => requestAnimationFrame(r));
    }
  }

  async function open() {
    isOpen = true;
    query = "";
    debouncedQuery = "";
    selectedIndex = 0;
    await focusInputRobustly();
  }

  function close() {
    isOpen = false;
    query = "";
    debouncedQuery = "";
    selectedIndex = 0;
  }

  async function executeCommand(cmd: CommandEntry) {
    close();
    const result = await commandCenter.execute(cmd.id);
    if (!result.success && result.error) {
      console.error(`[CommandPalette] ${cmd.id} failed:`, result.error);
    }
  }

  function moveSelection(delta: number) {
    if (!flatList.length) return;
    selectedIndex = (selectedIndex + delta + flatList.length) % flatList.length;
    requestAnimationFrame(() => {
      document
        .querySelector(`[data-cmd-index="${selectedIndex}"]`)
        ?.scrollIntoView({ block: "nearest" });
    });
  }

  function handleWindowKeydown(e: KeyboardEvent) {
    if (!isOpen) return;

    if (e.key === "Escape") {
      e.preventDefault();
      close();
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      moveSelection(1);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      moveSelection(-1);
    } else if (e.key === "Enter") {
      if (
        document.activeElement === inputEl ||
        !document.activeElement ||
        document.activeElement === document.body
      ) {
        e.preventDefault();
        const cmd = flatList[selectedIndex];
        if (cmd) executeCommand(cmd);
      }
    }
  }

  $effect(() => {
    void debouncedQuery;
    selectedIndex = 0;
  });

  $effect(() => {
    if (isOpen) {
      focusInputRobustly();
    }
  });

  // ---------- 导航方法 ----------
  function goBack() {
    if (!canGoBack) return;
    navigation.back();
  }

  function goForward() {
    if (!canGoForward) return;
    navigation.forward();
  }

  function goHome() {
    if (!isNotHome) return;
    push("/");
  }

  // ---------- 生命周期 ----------
  onMount(() => {
    // 初始化导航状态
    updateNavState();

    // 监听历史变化（包括 push、replace、前进、后退）
    navigation.addEventListener("currententrychange", updateNavState);

    // 快捷键
    hotkeys("ctrl+p, ctrl+shift+p", (e) => {
      e.preventDefault();
      if (isOpen) {
        close();
      } else {
        open();
      }
    });

    return () => {
      navigation.removeEventListener("currententrychange", updateNavState);
      hotkeys.unbind("ctrl+p");
      hotkeys.unbind("ctrl+shift+p");
    };
  });

  onDestroy(() => {
    // 已在 onMount 中清理
  });
</script>

<!-- 模板与原来完全一致，但 now uses canGoBack / canGoForward directly -->
<svelte:window onkeydown={handleWindowKeydown} />

<div
  class="relative flex w-full max-w-md items-center gap-1.5"
  style="-webkit-app-region: no-drag;"
>
  <!-- 后退按钮 -->
  <button
    type="button"
    onclick={goBack}
    disabled={!canGoBack}
    class="flex size-6 shrink-0 items-center justify-center rounded-md transition-all duration-200 {canGoBack
      ? 'text-foreground hover:bg-accent'
      : 'cursor-not-allowed text-muted-foreground/15 opacity-40'}"
    aria-label="后退"
  >
    <IconArrowLeft size={14} stroke={1.5} />
  </button>

  <!-- 前进按钮 -->
  <button
    type="button"
    onclick={goForward}
    disabled={!canGoForward}
    class="flex size-6 shrink-0 items-center justify-center rounded-md transition-all duration-200 {canGoForward
      ? 'text-foreground hover:bg-accent'
      : 'cursor-not-allowed text-muted-foreground/15 opacity-40'}"
    aria-label="前进"
  >
    <IconArrowRight size={14} stroke={1.5} />
  </button>

  <!-- 中间命令面板触发条（不变） -->
  <div class="relative flex-1">
    <button
      type="button"
      onclick={open}
      class="flex h-6 w-full items-center justify-center gap-2 rounded-md border border-sidebar-border/70 bg-sidebar-accent/40 text-center transition-colors duration-200 hover:bg-sidebar-accent"
      aria-haspopup="listbox"
      aria-expanded={isOpen}
    >
      <IconSearch
        size={12}
        stroke={1.5}
        class="shrink-0 text-sidebar-foreground/60"
      />
      <span class="truncate text-xs text-sidebar-foreground/70">{title}</span>
    </button>

    {#if isOpen}
      <div
        in:scale={{ duration: 200, start: 0.95, opacity: 0, easing: quintOut }}
        out:scale={{ duration: 150, start: 1, opacity: 0, easing: quintOut }}
        class="absolute left-1/2 top-0 z-200 w-120 max-w-[92vw] -translate-x-1/2 overflow-hidden rounded-xl border border-border/50 bg-popover text-popover-foreground shadow-2xl"
        style="-webkit-app-region: no-drag;"
        role="listbox"
      >
        <div
          class="flex items-center gap-2.5 border-b border-border/50 px-3.5 py-2.5"
        >
          <IconSearch
            size={16}
            stroke={1.5}
            class="shrink-0 text-muted-foreground"
          />
          <input
            bind:this={inputEl}
            bind:value={query}
            type="text"
            placeholder="Type a command…"
            autocomplete="off"
            spellcheck="false"
            class="flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
          />
        </div>

        <div class="cmd-scroll max-h-85 overflow-y-auto p-1.5">
          {#if flatList.length === 0}
            <div
              class="flex flex-col items-center justify-center gap-2 py-10 text-center"
            >
              <div class="rounded-lg bg-muted p-2.5">
                <IconSearch
                  size={16}
                  stroke={1.5}
                  class="text-muted-foreground"
                />
              </div>
              <p class="text-sm text-muted-foreground">No matching commands</p>
            </div>
          {:else}
            {#each categories as category (category)}
              <div class="mb-1">
                <div class="flex items-center gap-1.5 px-2 py-1.5">
                  <span
                    class="text-[10px] font-medium uppercase tracking-wider text-muted-foreground"
                  >
                    {category}
                  </span>
                  <span class="text-[10px] text-muted-foreground/60">
                    {grouped[category].length}
                  </span>
                </div>

                <ul class="space-y-0.5">
                  {#each grouped[category] as cmd (cmd.id)}
                    {@const globalIndex = flatList.findIndex(
                      (c) => c.id === cmd.id,
                    )}
                    {@const isSelected = selectedIndex === globalIndex}
                    {@const hotkey = getHotkeyForCommand(cmd.id)}
                    <li>
                      <button
                        type="button"
                        data-cmd-index={globalIndex}
                        onclick={() => executeCommand(cmd)}
                        onmouseenter={() => (selectedIndex = globalIndex)}
                        class="flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-left transition-colors duration-200 {isSelected
                          ? 'bg-primary/10'
                          : 'hover:bg-muted'}"
                        role="option"
                        aria-selected={isSelected}
                      >
                        <div
                          class="flex h-5 w-5 shrink-0 items-center justify-center rounded-md transition-colors duration-200 {isSelected
                            ? 'bg-primary/20 text-primary'
                            : 'bg-muted text-muted-foreground'}"
                        >
                          <IconChevronRight size={11} stroke={1.5} />
                        </div>

                        <div class="min-w-0 flex-1">
                          <p
                            class="truncate text-sm font-medium leading-tight text-foreground"
                          >
                            {cmd.label}
                          </p>
                          {#if cmd.description}
                            <p
                              class="mt-0.5 truncate text-xs text-muted-foreground"
                            >
                              {cmd.description}
                            </p>
                          {/if}
                        </div>

                        {#if hotkey}
                          <kbd
                            class="shrink-0 rounded-md border border-border/50 bg-background/60 px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground"
                          >
                            {hotkey}
                          </kbd>
                        {/if}

                        {#if isSelected}
                          <IconCornerDownLeft
                            size={12}
                            stroke={1.5}
                            class="shrink-0 text-primary"
                          />
                        {/if}
                      </button>
                    </li>
                  {/each}
                </ul>
              </div>
            {/each}
          {/if}
        </div>

        <div
          class="flex items-center justify-between border-t border-border/50 bg-muted/30 px-3.5 py-2"
        >
          <div
            class="flex items-center gap-2.5 text-[10px] text-muted-foreground"
          >
            <span class="flex items-center gap-1">
              <kbd
                class="rounded-md border border-border/50 bg-background px-1 py-0.5 font-mono"
              >
                <IconArrowUp size={10} stroke={1.5} class="inline" />
              </kbd>
              <kbd
                class="rounded-md border border-border/50 bg-background px-1 py-0.5 font-mono"
              >
                <IconArrowDown size={10} stroke={1.5} class="inline" />
              </kbd>
            </span>
            <span class="flex items-center gap-1">
              <kbd
                class="rounded-md border border-border/50 bg-background px-1 py-0.5 font-mono"
              >
                <IconCornerDownLeft size={10} stroke={1.5} class="inline" />
              </kbd>
              run
            </span>
            <span class="flex items-center gap-1">
              <kbd
                class="rounded-md border border-border/50 bg-background px-1.5 py-0.5 font-mono"
                >esc</kbd
              >
            </span>
          </div>
          <span class="text-[10px] text-muted-foreground/70"
            >{flatList.length}</span
          >
        </div>
      </div>
    {/if}
  </div>

  <!-- 回到主控台按钮（不变） -->
  <button
    type="button"
    onclick={goHome}
    disabled={!isNotHome}
    class="flex size-6 shrink-0 items-center justify-center rounded-md transition-all duration-200 {isNotHome
      ? 'bg-linear-to-br from-blue-500 to-purple-600 text-white shadow-md hover:scale-110 hover:shadow-lg active:scale-95 dark:from-blue-600 dark:to-purple-700'
      : 'cursor-not-allowed bg-transparent text-muted-foreground/15 opacity-40'}"
    aria-label="回到主控台"
  >
    <IconHome2
      size={14}
      stroke={2}
      class="transition-transform duration-200 {isNotHome
        ? 'scale-100'
        : 'scale-90'}"
    />
  </button>
</div>

{#if isOpen}
  <div
    transition:fade={{ duration: 120 }}
    class="fixed inset-0 z-100"
    style="-webkit-app-region: no-drag;"
    onclick={close}
    onkeydown={() => {}}
    role="button"
    tabindex="-1"
    aria-label="Close command palette"
  ></div>
{/if}

<style>
  .cmd-scroll::-webkit-scrollbar {
    width: 8px;
  }
  .cmd-scroll::-webkit-scrollbar-track {
    background: transparent;
  }
  .cmd-scroll::-webkit-scrollbar-thumb {
    background: hsl(var(--muted));
    border-radius: 4px;
  }
  .cmd-scroll::-webkit-scrollbar-thumb:hover {
    background: hsl(var(--muted-foreground) / 0.3);
  }
</style>
