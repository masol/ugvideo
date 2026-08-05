<script lang="ts">
  import * as ImageZoom from "$lib/components/ui/image-zoom/index";
  import { projectStore } from "$lib/store/project.svelte";
  import { IconFileText } from "@tabler/icons-svelte";
  import VideoPlayer from "svelte-video-player";
  import ViewerToolbar from "./ViewerToolbar.svelte";

  const src = $derived(projectStore.mediaURL ?? "");

  const ext = $derived.by(() => {
    if (!src) return "";
    const m = src.match(/\.([a-z0-9]+)(?:\?.*)?$/i);
    return m ? m[1].toLowerCase() : "";
  });

  const kind = $derived.by(() => {
    if (!src) return "unknown" as const;
    if (
      ["png", "jpg", "jpeg", "gif", "webp", "bmp", "svg", "avif"].includes(ext)
    )
      return "image" as const;
    if (["mp4", "webm", "ogg", "mov", "mkv", "avi", "m4v"].includes(ext))
      return "video" as const;
    return "unknown" as const;
  });

  let scale = $state(1);

  function resetScale() {
    scale = 1;
  }
</script>

<div
  class="flex h-full w-full min-h-0 min-w-0 flex-col overflow-hidden rounded-3xl border border-border/50 bg-background/95 shadow-xl"
>
  <ViewerToolbar {src} {kind} bind:scale onReset={resetScale} />

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
          <p class="text-xs text-muted-foreground">
            在术语表中选择含素材的条目即可在此查看
          </p>
        </div>
      </div>
    {:else if kind === "image"}
      <!-- 关键：用 src 作为 key，强制重建 Trigger -->
      <div
        class="flex h-full w-full items-center justify-center overflow-hidden"
        style="transform: scale({scale}); transform-origin: center; transition: transform 0.2s ease;"
      >
        {#key src}
          <ImageZoom.Trigger
            {src}
            alt={src}
            class="max-h-full max-w-full object-contain cursor-zoom-in"
          />
        {/key}
      </div>
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
