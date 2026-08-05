<!-- src/lib/editor/AssetPreviewDialog.svelte -->
<script lang="ts">
  import type { DialogComponentProps } from "$lib/types/dialog";
  import { IconFileText } from "@tabler/icons-svelte";
  import VideoPlayer from "svelte-video-player";
  import type { MediaKind } from "../../featured/bottom/media/types";
  import ViewerToolbar from "../../featured/bottom/media/ViewerToolbar.svelte";

  type Props = {
    src: string;
    name?: string;
    path?: string;
  } & DialogComponentProps<void>;

  let { src = "", name = "", path = "" }: Props = $props();

  const label = $derived(path || name || src);

  const ext = $derived.by(() => {
    const target = path || src;
    if (!target) return "";
    const m = target.match(/\.([a-z0-9]+)(?:\?.*)?$/i);
    return m ? m[1].toLowerCase() : "";
  });

  const kind = $derived.by<MediaKind>(() => {
    if (!src) return "unknown";
    if (
      ["png", "jpg", "jpeg", "gif", "webp", "bmp", "svg", "avif"].includes(ext)
    )
      return "image";
    if (["mp4", "webm", "ogg", "mov", "mkv", "avi", "m4v"].includes(ext))
      return "video";
    return "unknown";
  });

  let scale = $state(1);
  let imgViewerKey = $state(0);

  function resetScale() {
    scale = 1;
    imgViewerKey += 1;
  }
</script>

<div class="flex flex-col" style="min-height: 75vh;">
  <ViewerToolbar src={label} {kind} bind:scale onReset={resetScale} />

  <div
    class="relative flex min-h-0 flex-1 items-center justify-center overflow-hidden bg-muted/20 p-6"
  >
    {#if !src}
      <div
        class="animate-fade-in flex flex-col items-center gap-3 px-8 text-center"
      >
        <div
          class="flex size-14 items-center justify-center rounded-2xl border border-border/50 bg-muted/50 text-muted-foreground"
        >
          <IconFileText size={24} stroke={1.5} />
        </div>
        <div class="space-y-1">
          <p class="text-sm font-medium text-foreground">没有素材</p>
          <p class="text-xs text-muted-foreground">未提供可预览的素材地址</p>
        </div>
      </div>
    {:else if kind === "image"}
      {#key imgViewerKey}
        <div
          class="flex h-full w-full items-center justify-center overflow-hidden"
          style="transform: scale({scale}); transform-origin: center; transition: transform 0.2s ease;"
        >
          <img {src} alt={label} class="max-h-full max-w-full object-contain" />
        </div>
      {/key}
    {:else if kind === "video"}
      <div
        class="flex h-full w-full items-center justify-center overflow-hidden"
        style="transform: scale({scale}); transform-origin: center; transition: transform 0.2s ease;"
      >
        <VideoPlayer source={src} />
      </div>
    {:else}
      <div class="flex flex-col items-center gap-2 text-center">
        <IconFileText size={28} stroke={1.5} class="text-muted-foreground" />
        <p class="text-sm font-medium text-foreground">不支持的媒体格式</p>
        <p class="font-mono text-xs text-muted-foreground">.{ext}</p>
      </div>
    {/if}
  </div>
</div>
