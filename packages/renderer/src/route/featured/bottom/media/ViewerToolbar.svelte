<script lang="ts">
  import { Button } from "$lib/components/ui/button";
  import * as Tooltip from "$lib/components/ui/tooltip";
  import {
    IconFileText,
    IconMovie,
    IconPhoto,
    IconRefresh,
    IconZoomIn,
    IconZoomOut,
  } from "@tabler/icons-svelte";
  import type { MediaKind, ViewerToolbarProps } from "./types";

  let {
    src = "",
    kind = "unknown",
    scale = $bindable(1),
    onReset,
  }: ViewerToolbarProps & { scale?: number; onReset?: () => void } = $props();

  function clamp(v: number) {
    return Math.min(5, Math.max(0.25, v));
  }

  function zoomIn() {
    scale = clamp(scale * 1.25);
  }

  function zoomOut() {
    scale = clamp(scale / 1.25);
  }

  function reset() {
    scale = 1;
    onReset?.();
  }

  const kindMeta: Record<MediaKind, { icon: typeof IconPhoto; label: string }> =
    {
      image: { icon: IconPhoto, label: "Image" },
      video: { icon: IconMovie, label: "Video" },
      unknown: { icon: IconFileText, label: "Unknown" },
    };

  const meta = $derived(kindMeta[kind]);
</script>

<div
  class="z-20 flex shrink-0 items-center justify-between gap-3 border-b border-border/50 bg-background/80 px-4 py-2.5 backdrop-blur-sm"
>
  <div class="flex min-w-0 items-center gap-2.5">
    <div
      class="flex size-7 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary"
    >
      <meta.icon size={16} stroke={1.5} />
    </div>
    <div class="min-w-0">
      <p class="truncate text-xs font-medium tracking-tight text-foreground">
        {meta.label}
      </p>
      <p
        class="truncate font-mono text-[10px] text-muted-foreground"
        title={src}
      >
        {src}
      </p>
    </div>
  </div>

  <div class="flex shrink-0 items-center gap-1">
    <Tooltip.Provider delayDuration={150}>
      <Tooltip.Root>
        <Tooltip.Trigger>
          {#snippet child({ props })}
            <Button
              {...props}
              variant="ghost"
              size="icon"
              class="size-7 rounded-lg"
              aria-label="缩小"
              onclick={zoomOut}
            >
              <IconZoomOut size={14} stroke={1.5} />
            </Button>
          {/snippet}
        </Tooltip.Trigger>
        <Tooltip.Content class="z-9999">缩小</Tooltip.Content>
      </Tooltip.Root>

      <Tooltip.Root>
        <Tooltip.Trigger>
          {#snippet child({ props })}
            <Button
              {...props}
              variant="ghost"
              size="icon"
              class="size-7 rounded-lg"
              aria-label="放大"
              onclick={zoomIn}
            >
              <IconZoomIn size={14} stroke={1.5} />
            </Button>
          {/snippet}
        </Tooltip.Trigger>
        <Tooltip.Content class="z-9999">放大</Tooltip.Content>
      </Tooltip.Root>

      <Tooltip.Root>
        <Tooltip.Trigger>
          {#snippet child({ props })}
            <Button
              {...props}
              variant="ghost"
              size="icon"
              class="size-7 rounded-lg"
              aria-label="重置"
              onclick={reset}
            >
              <IconRefresh size={14} stroke={1.5} />
            </Button>
          {/snippet}
        </Tooltip.Trigger>
        <Tooltip.Content class="z-9999">重置缩放</Tooltip.Content>
      </Tooltip.Root>
    </Tooltip.Provider>

    <span
      class="border-border/50 bg-muted/30 ml-2 inline-flex items-center rounded-lg border px-2 py-0.5 font-mono text-[10px] tabular-nums text-muted-foreground"
    >
      {Math.round(scale * 100)}%
    </span>
  </div>
</div>
