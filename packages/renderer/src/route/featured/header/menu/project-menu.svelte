<!--╭─────────────────────────────────────────────────────────╮ -->
<!-- │ [子组件 → header/menu/project-menu.svelte]              │ -->
<!-- │ 职责：新建 / 打开 / 最近 / 关闭 / 退出                    │ -->
<!-- ╰─────────────────────────────────────────────────────────╯ -->
<script lang="ts">
  import { RuntimeIcon } from "$lib/components/runtimeicon";
  import * as Menubar from "$lib/components/ui/menubar";
  import { dashboardStore } from "$lib/store/dashboard.svelte";
  import { i18nStore } from "$lib/store/i18n.svelte";
  import { projectStore } from "$lib/store/project.svelte";
  import { recentProjectsStore } from "$lib/store/recent-projects.svelte";
  import { confirmStore } from "$lib/store/ui/confirm.svelte";
  import { windowStore } from "$lib/store/window.svelte";
  import { safeApi } from "$lib/utils/api";
  import type { RecentProject } from "@app/main/types";
  import {
    IconAppWindow,
    IconFilePlus,
    IconFolderOpen,
    IconFolderX,
    IconHistory,
    IconHistoryOff,
    IconLoader2,
    IconLogout,
  } from "@tabler/icons-svelte";
  import MenuShortcut from "./menu-shortcut.svelte";

  const isBusy = $derived(projectStore.isBusy);
  const hasProject = $derived(!!projectStore.path);
  const canClose = $derived(hasProject && !isBusy);

  const recents = $derived(recentProjectsStore.projects);
  const recentsLoading = $derived(recentProjectsStore.isLoading);
  const recentsEmpty = $derived(recentProjectsStore.isEmpty);

  async function openProject() {
    if (isBusy) return;
    await projectStore.open();
  }
  async function newProject() {
    if (isBusy) return;
    await projectStore.create();
  }
  async function openRecent(project: RecentProject) {
    if (isBusy) return;
    await projectStore.open(project.path);
  }
  async function closeProject() {
    if (!canClose) return;
    await projectStore.close();
  }

  async function newWindow() {
    if (isBusy) return;
    await safeApi().window.newwin();
  }

  async function clearRecent() {
    await recentProjectsStore.clear();
  }
  async function quit() {
    if (dashboardStore.runState === "running") {
      const confirmed = await confirmStore.request({
        title: "确认退出",
        message: "项目任务正在执行中，确认退出程序吗？",
        variant: "question",
      });
      if (!confirmed) return;
    }
    windowStore.close();
  }
</script>

<Menubar.Menu>
  <Menubar.Trigger
    class="cursor-default select-none h-9 rounded-none px-2.5 text-xs font-normal data-[state=open]:bg-accent/80 hover:bg-accent/80"
  >
    项目
  </Menubar.Trigger>
  <Menubar.Content align="start" class="select-none z-200 min-w-52">
    <Menubar.Item disabled={isBusy} onSelect={newWindow}>
      <IconAppWindow
        size={20}
        stroke={1.5}
        class="mr-2 text-muted-foreground"
      />
      打开新窗口
      <MenuShortcut command="project.create" />
    </Menubar.Item>

    <Menubar.Separator />

    <Menubar.Item disabled={isBusy} onSelect={newProject}>
      <IconFilePlus size={20} stroke={1.5} class="mr-2 text-muted-foreground" />
      新建项目
      <MenuShortcut command="project.create" />
    </Menubar.Item>
    <Menubar.Item disabled={isBusy} onSelect={openProject}>
      <IconFolderOpen
        size={20}
        stroke={1.5}
        class="mr-2 text-muted-foreground"
      />
      打开项目...
      <MenuShortcut command="project.open" />
    </Menubar.Item>

    <Menubar.Sub>
      <Menubar.SubTrigger disabled={isBusy}>
        <IconHistory
          size={20}
          stroke={1.5}
          class="mr-2 text-muted-foreground"
        />
        最近打开
      </Menubar.SubTrigger>
      <Menubar.SubContent side="right" align="start" class="z-200 min-w-64">
        {#if recentsLoading}
          <div
            class="flex items-center gap-2 px-2 py-1.5 text-xs text-muted-foreground"
          >
            <IconLoader2 size={20} stroke={1.5} class="animate-spin" />
            加载中...
          </div>
        {:else if recentsEmpty}
          <div class="px-2 py-1.5 text-xs text-muted-foreground">
            暂无最近项目
          </div>
        {:else}
          {#each recents as r (r.path)}
            <Menubar.Item disabled={isBusy} onSelect={() => openRecent(r)}>
              <span
                class="mr-2 flex size-5 shrink-0 items-center justify-center text-muted-foreground"
              >
                <RuntimeIcon name={r.icon} size={20} />
              </span>
              <span class="flex min-w-0 flex-col">
                <span class="truncate">{r.path.split(/[/\\]/).pop()}</span>
                <span class="truncate text-xs text-muted-foreground">
                  {i18nStore.dayjs(r.time).fromNow()}
                </span>
              </span>
            </Menubar.Item>
          {/each}
          <Menubar.Separator></Menubar.Separator>
          <Menubar.Item disabled={isBusy} onSelect={() => clearRecent()}>
            <span
              class="mr-2 flex size-5 shrink-0 items-center justify-center text-muted-foreground"
            >
              <IconHistoryOff size={20} />
            </span>
            <span class="flex min-w-0 flex-col">
              <span class="truncate">清空历史记录</span>
            </span>
          </Menubar.Item>
        {/if}
      </Menubar.SubContent>
    </Menubar.Sub>

    <Menubar.Separator />

    <Menubar.Item disabled={!canClose} onSelect={closeProject}>
      <IconFolderX size={20} stroke={1.5} class="mr-2 text-muted-foreground" />
      关闭项目
      <MenuShortcut command="project.close" />
    </Menubar.Item>

    <Menubar.Separator />

    <Menubar.Item onSelect={quit}>
      <IconLogout size={20} stroke={1.5} class="mr-2 text-muted-foreground" />
      退出
    </Menubar.Item>
  </Menubar.Content>
</Menubar.Menu>
