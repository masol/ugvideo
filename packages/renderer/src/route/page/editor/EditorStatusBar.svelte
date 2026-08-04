<!-- src/lib/editor/EditorStatusBar.svelte -->
<!-- 底部状态栏：只读 editorStore，展示光标/字数，零直接通信。 -->
<script lang="ts">
  import { Skeleton } from "$lib/components/ui/skeleton";
  import {
    IconAlignJustified,
    IconLetterCase,
    IconMapPin,
    IconTextWrap,
  } from "@tabler/icons-svelte";
  import RunState from "../../RunState.svelte";
  import { editorStore as store } from "./store.svelte";
</script>

{#if store.loading}
  <Skeleton class="h-3 w-24 rounded-lg" />
  <Skeleton class="h-3 w-20 rounded-lg" />
  <Skeleton class="ml-auto h-3 w-28 rounded-lg" />
{:else}
  <div class="flex items-center gap-1.5">
    <IconMapPin size={20} stroke={1.5} class="size-3.5" />
    <span>行 {store.cursorLine}，列 {store.cursorColumn}</span>
  </div>

  {#if store.selectionLength > 0}
    <div class="flex items-center gap-1.5 animate-fade-in">
      <IconLetterCase size={20} stroke={1.5} class="size-3.5" />
      <span>已选 {store.selectionLength}</span>
    </div>
  {/if}

  <div class="flex items-center gap-1.5">
    <IconAlignJustified size={20} stroke={1.5} class="size-3.5" />
    <span>{store.charCount} 字符 · {store.lineCount} 行</span>
  </div>

  {#if store.wordWrap}
    <div class="flex items-center gap-1.5">
      <IconTextWrap size={20} stroke={1.5} class="size-3.5" />
      <span>自动换行</span>
    </div>
  {/if}

  <div class="ml-auto flex items-center gap-3">
    <span class="text-muted-foreground/70">{store.kindLabel}</span>
    <RunState></RunState>
  </div>
{/if}
