<script lang="ts">
  import { projectStore } from "$lib/store/project.svelte";
  import { IconFileText } from "@tabler/icons-svelte";
  import { ImageViewer } from "svelte-image-viewer";
  import VideoPlayer from "svelte-video-player";
  import ViewerToolbar from "./ViewerToolbar.svelte";

  // ── 自适应占满父级 ──
  // 让 panel 自身在父容器里有正确的高度/宽度
  // 父组件会用 <ViewerPanel /> 直接嵌入（bar.svelte 已经给出 flex 容器）

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

  // ── 缩放状态（图片直接绑定；视频走 CSS 缩放包裹层） ──
  let scale = $state(1);

  function resetScale() {
    scale = 1;
    // 同时重置 svelte-image-viewer 内部的 pan/zoom 偏移
    imgViewerKey = imgViewerKey + 1;
  }

  // 用 key 强制重挂载，使 ImageViewer 内部状态归零
  let imgViewerKey = $state(0);

  // ── svelte-image-viewer 的 ImageViewer 接受 scale prop 文档中未列出，
  // ── 因此图片使用「CSS 缩放包裹层」方案，按你的指示全部统一为外层 transform ──
</script>

<!--╭─────────────────────────────────────────────────────────────╮ -->
<!-- │ [ViewerPanel.svelte]                                         │ -->
<!-- │ 职责：全宽全高媒体查看器 · toolbar 固定顶部 ·                 │ -->
<!-- │       内容居中按外层 transform 统一缩放                       │ -->
<!-- ╰─────────────────────────────────────────────────────────────╯ -->
<div
  class="flex h-full w-full min-h-0 min-w-0 flex-col overflow-hidden rounded-3xl border border-border/50 bg-background/95 shadow-xl"
>
  <ViewerToolbar {src} {kind} bind:scale onReset={resetScale} />

  <!-- 内容区域：高度 = panel 高度 - toolbar 高度, 全宽, 内容居中 -->
  <div
    class="relative flex min-h-0 flex-1 items-center justify-center overflow-hidden bg-muted/20 p-6"
  >
    {#if !src}
      <!-- 空状态 -->
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
      <!-- 缩放包裹层：占据 panel 全部可用空间，包内元素自适应填满 -->
      {#key imgViewerKey}
        <div
          class="flex h-full w-full items-center justify-center overflow-hidden"
          style="transform: scale({scale}); transform-origin: center; transition: transform 0.2s ease;"
          data-image-wrapper
        >
          <ImageViewer {src} alt={src}></ImageViewer>
        </div>
      {/key}
    {:else if kind === "video"}
      <!-- 视频：CSS 缩放外围容器，内部 video 元素 100% 填满容器 -->
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
<!-- ╭─── / ViewerPanel ───╮ -->
