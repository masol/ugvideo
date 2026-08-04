<!-- src/lib/editor/EditorToolbar.svelte -->
<script lang="ts">
  import { Badge } from "$lib/components/ui/badge";
  import { Button } from "$lib/components/ui/button";
  import { Separator } from "$lib/components/ui/separator";
  import { Spinner } from "$lib/components/ui/spinner";
  import * as Tooltip from "$lib/components/ui/tooltip";
  import {
    IconArrowBackUp,
    IconArrowForwardUp,
    IconBrandJavascript,
    IconCommand,
    IconDeviceFloppy,
    IconFileDescription,
    IconJson,
    IconMap,
    IconMarkdown,
    IconReload,
    IconSearch,
    IconTextWrap,
    IconWand,
  } from "@tabler/icons-svelte";
  import PathAssetMenu from "./PathAssetMenu.svelte";
  import { editorStore as store } from "./store.svelte";

  const langIcon = $derived(
    store.editorLang === "json"
      ? IconJson
      : store.editorLang === "js"
        ? IconBrandJavascript
        : IconMarkdown,
  );
</script>

{#snippet toolBtn(
  label: string,
  Icon: typeof IconSearch,
  onclick: () => void,
  opts?: { active?: boolean; disabled?: boolean; loading?: boolean },
)}
  <Tooltip.Root>
    <Tooltip.Trigger>
      {#snippet child({ props })}
        <Button
          {...props}
          variant={opts?.active ? "secondary" : "ghost"}
          size="icon"
          class="size-9 rounded-xl transition-all duration-200"
          disabled={opts?.disabled || store.readonly}
          {onclick}
        >
          {#if opts?.loading}
            <Spinner class="size-5" />
          {:else}
            <Icon size={20} stroke={1.5} />
          {/if}
        </Button>
      {/snippet}
    </Tooltip.Trigger>
    <Tooltip.Content>{label}</Tooltip.Content>
  </Tooltip.Root>
{/snippet}

<Tooltip.Provider delayDuration={300}>
  <div
    class="flex shrink-0 items-center gap-3 border-b border-border/50 px-4 py-2.5"
  >
    <!-- 左侧文件元信息 + 素材下拉 -->
    <div class="flex min-w-0 items-center gap-3">
      {#if store.loading}
        {@const Icon = IconFileDescription}
        <Icon size={24} stroke={1.5} class="shrink-0 text-muted-foreground" />
      {:else}
        {@const Icon = langIcon}
        <Icon size={24} stroke={1.5} class="shrink-0 text-primary" />
      {/if}

      <div class="flex min-w-0 flex-col">
        <div class="flex items-center gap-2">
          <span class="truncate text-sm font-medium">{store.fileName}</span>
          {#if store.dirty}
            <span
              class="size-2 shrink-0 rounded-full bg-primary animate-fade-in"
              title="未保存的更改"
            ></span>
          {/if}
        </div>
        <span class="truncate text-xs text-muted-foreground">
          {store.id ? `#${store.id}` : "未指定 ID"}
        </span>
      </div>

      <Badge variant="secondary" class="ml-1 shrink-0 rounded-lg"
        >{store.kindLabel}</Badge
      >

      <!-- 素材下拉：仅在 JSON 编辑器且识别到路径字段时出现 -->
      {#if store.editorLang === "json" && store.pathAssets?.length > 0}
        <div class="ml-1">
          <PathAssetMenu assets={store.pathAssets} />
        </div>
      {/if}
    </div>

    <div class="ml-auto flex items-center gap-1.5">
      <!-- ── 异步主操作：仅保留"保存"与"重新加载" ── -->
      {#if store.dirty}
        {@render toolBtn(
          "保存 (Ctrl+S)",
          IconDeviceFloppy,
          () => store.save(),
          {
            loading: store.busyAction === "save",
            disabled: store.busy && store.busyAction !== "save",
          },
        )}
      {/if}
      {@render toolBtn("重新加载", IconReload, () => store.reload(), {
        loading: store.busyAction === "reload",
        disabled: store.busy && store.busyAction !== "reload",
      })}
      <Separator orientation="vertical" class="mx-1 h-6" />

      <!-- ── 常用编辑功能 ── -->
      {@render toolBtn("撤销", IconArrowBackUp, () => store.undo())}
      {@render toolBtn("重做", IconArrowForwardUp, () => store.redo())}
      {@render toolBtn("格式化文档", IconWand, () => store.format())}
      {@render toolBtn("查找", IconSearch, () => store.find())}
      {@render toolBtn("命令面板 (F1)", IconCommand, () =>
        store.commandPalette(),
      )}

      <Separator orientation="vertical" class="mx-1 h-6" />

      {@render toolBtn("自动换行", IconTextWrap, () => store.toggleWordWrap(), {
        active: store.wordWrap,
      })}
      {@render toolBtn("小地图", IconMap, () => store.toggleMinimap(), {
        active: store.minimap,
      })}
    </div>
  </div>
</Tooltip.Provider>
