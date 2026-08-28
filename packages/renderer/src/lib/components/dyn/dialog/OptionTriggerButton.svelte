<!--
  ╭─────────────────────────────────────────────────────╮
  │ [下拉触发按钮 → OptionTriggerButton.svelte]           │
  │ 职责：作为 Popover.Trigger 的展示层按钮，纯呈现     │
  │ 通过 ...rest 接收 Popover.Trigger 委托的 aria/事件属性 │
  ╰─────────────────────────────────────────────────────╯
-->
<script lang="ts">
  import { IconChevronDown, IconSparkles } from "@tabler/icons-svelte";
  import type { HTMLButtonAttributes } from "svelte/elements";

  type Props = HTMLButtonAttributes & { open?: boolean };

  let { open = false, class: className = "", ...rest }: Props = $props();
</script>

<button
  type="button"
  {...rest}
  aria-label="插入预设片段"
  aria-expanded={open}
  class="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-xl border border-border/50 bg-background px-2.5 text-xs font-medium text-muted-foreground transition-all duration-200 hover:border-primary/50 hover:bg-accent hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50 {className}"
>
  <IconSparkles size={14} stroke={1.5} />
  <span>插入片段</span>
  <IconChevronDown
    size={12}
    stroke={1.5}
    class="transition-transform duration-200 {open ? 'rotate-180' : ''}"
  />
</button>
