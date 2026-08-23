<!-- src/lib/components/chat/ChatCommandMenu.svelte -->
<script lang="ts">
  import autoAnimate from "@formkit/auto-animate";
  import { IconSlash } from "@tabler/icons-svelte";
  import type { ChatCommand } from "./commands";

  let {
    commands = [],
    selectedIndex = 0,
    onSelect = () => {},
  }: {
    commands?: ChatCommand[];
    selectedIndex?: number;
    onSelect?: (cmd: ChatCommand) => void;
  } = $props();

  let listContainer = $state<HTMLDivElement>();

  // 键盘移动高亮项时，自动滚入视图
  $effect(() => {
    if (!listContainer) return;
    const el = listContainer.querySelector(
      `[data-command-index="${selectedIndex}"]`,
    ) as HTMLElement | null;
    el?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  });
</script>

<div
  class="absolute bottom-full left-0 mb-2 w-full overflow-hidden rounded-xl border border-border/50 bg-popover shadow-xl animate-slide-up"
>
  {#if commands[selectedIndex]}
    <div class="border-t border-border/50 bg-muted/30 px-3 py-2">
      <p class="text-xs font-medium text-foreground">
        {commands[selectedIndex].label}
      </p>
      <p
        class="mt-0.5 whitespace-pre-wrap text-xs leading-relaxed text-muted-foreground"
      >
        {commands[selectedIndex].desc}
      </p>
    </div>
  {/if}
  <div
    bind:this={listContainer}
    class="max-h-60 overflow-y-auto scroll-smooth p-2"
    use:autoAnimate
  >
    {#each commands as cmd, i (cmd.id)}
      <button
        type="button"
        data-command-index={i}
        onclick={() => onSelect(cmd)}
        title={`${cmd.label} — ${cmd.desc}`}
        class="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left transition-all duration-200 {i ===
        selectedIndex
          ? 'bg-primary/10'
          : 'hover:bg-accent'}"
      >
        <span
          class="flex size-8 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground"
        >
          <IconSlash size={16} stroke={1.5} />
        </span>
        <span class="min-w-0 flex-1">
          <span class="block truncate text-sm font-medium text-foreground">
            {cmd.label}
          </span>
          <span class="block truncate text-xs text-muted-foreground">
            {cmd.desc}
          </span>
        </span>
      </button>
    {/each}
  </div>
</div>
