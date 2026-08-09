<script lang="ts">
  import * as AlertDialog from "$lib/components/ui/alert-dialog";
  import { Button } from "$lib/components/ui/button";
  import { PinyinFuseSearch } from "$lib/utils/fuse";
  import autoAnimate from "@formkit/auto-animate";
  import { IconFolderOpen, IconRefresh } from "@tabler/icons-svelte";
  import { onMount } from "svelte";
  import ProjectTypeGrid from "./ProjectTypeGrid.svelte";
  import {
    fetchInstalledProjectTypes,
    openInstallDirectory,
    uninstallProjectType,
  } from "./service";
  import type { ProjectType } from "./types";

  type Props = { query: string };
  let { query }: Props = $props();

  let isLoading = $state(true);
  let installed = $state<ProjectType[]>([]);
  let deletingId = $state<string | null>(null); // 正在卸载中的 id
  let pendingDelete = $state<ProjectType | null>(null); // 待确认卸载的目标
  let openingDir = $state(false);

  // 与原实现一致:本地搜索继续用定制的拼音 Fuse。
  const searcher = $derived(
    new PinyinFuseSearch(
      installed.map((t) => ({ id: t.id, text: `${t.name} ${t.description}` })),
    ),
  );

  const trimmed = $derived(query.trim());
  const filtered = $derived.by<ProjectType[]>(() => {
    if (!trimmed) return installed;
    const ids = new Set(searcher.search(trimmed) as Array<string | number>);
    return installed.filter((t) => ids.has(t.id));
  });

  async function load(bForce?: boolean) {
    isLoading = true;
    try {
      installed = await fetchInstalledProjectTypes(bForce);
    } catch {
      installed = [];
    } finally {
      isLoading = false;
    }
  }

  async function confirmDelete() {
    const target = pendingDelete;
    pendingDelete = null;
    if (!target) return;
    deletingId = target.id;
    try {
      await uninstallProjectType(target.id);
      installed = installed.filter((t) => t.id !== target.id);
    } catch {
      // 卸载失败:保留原数据,交由上层错误提示体系处理
    } finally {
      deletingId = null;
    }
  }

  async function openDir() {
    openingDir = true;
    try {
      await openInstallDirectory();
    } catch {
      // 打开目录失败:交由上层提示
    } finally {
      openingDir = false;
    }
  }

  onMount(load);
</script>

<div class="flex h-full flex-col gap-4">
  <!-- 工具条:数量 + 打开目录 + 刷新 -->
  <div class="flex shrink-0 items-center justify-between gap-2">
    <p class="text-xs text-muted-foreground">
      {#if isLoading}加载中…{:else}共 {filtered.length} 个项目类型{/if}
    </p>
    <div class="flex items-center gap-1">
      <Button
        variant="ghost"
        size="sm"
        class="gap-1.5 rounded-lg text-muted-foreground"
        onclick={openDir}
        disabled={openingDir}
      >
        <IconFolderOpen class="size-4" /> 打开插件目录
      </Button>
      <Button
        variant="ghost"
        size="sm"
        class="gap-1.5 rounded-lg text-muted-foreground"
        onclick={() => load(true)}
        disabled={isLoading}
      >
        <IconRefresh class="size-4 {isLoading ? 'animate-spin' : ''}" /> 刷新
      </Button>
    </div>
  </div>

  <!-- 可滚动网格 -->
  <div use:autoAnimate class="min-h-0 flex-1 overflow-y-auto pr-1">
    <ProjectTypeGrid
      {isLoading}
      items={filtered}
      hasQuery={trimmed.length > 0}
      {deletingId}
      onUninstall={(t) => (pendingDelete = t)}
    >
      {#snippet emptyAction()}
        {#if !trimmed}
          <Button
            variant="outline"
            size="sm"
            class="gap-1.5 rounded-lg"
            onclick={openDir}
          >
            <IconFolderOpen class="size-4" /> 打开插件目录
          </Button>
        {/if}
      {/snippet}
    </ProjectTypeGrid>
  </div>
</div>

<!-- 卸载确认 -->
<AlertDialog.Root
  open={pendingDelete !== null}
  onOpenChange={(o) => {
    if (!o) pendingDelete = null;
  }}
>
  <AlertDialog.Content>
    <AlertDialog.Header>
      <AlertDialog.Title>卸载项目类型?</AlertDialog.Title>
      <AlertDialog.Description>
        将从本机移除「{pendingDelete?.name}」。已用该类型创建的项目不受影响。
      </AlertDialog.Description>
    </AlertDialog.Header>
    <AlertDialog.Footer>
      <AlertDialog.Cancel>取消</AlertDialog.Cancel>
      <AlertDialog.Action
        onclick={confirmDelete}
        class="bg-destructive text-destructive-foreground hover:bg-destructive/90"
      >
        卸载
      </AlertDialog.Action>
    </AlertDialog.Footer>
  </AlertDialog.Content>
</AlertDialog.Root>
