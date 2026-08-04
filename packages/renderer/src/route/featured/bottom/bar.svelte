<script lang="ts">
  import PanelHeader from "$lib/components/pannel-header.svelte";
  import { layoutStore } from "$lib/store/ui/layout.svelte";
  import {
    IconBook2,
    IconDotsVertical,
    IconEye,
    IconLayoutSidebarRightExpand,
    IconSitemap,
  } from "@tabler/icons-svelte";
  import FlowCanvas from "../../page/flow/FlowCanvas.svelte";
  import FlowToolbar from "../../page/flow/FlowToolbar.svelte";
  import { flowStore } from "../../page/flow/store.svelte";
  import BottomPanelTabs from "./bar.header.svelte";
  import { bottomPanelStore } from "./bar.store.svelte";
  import HookLogViewer from "./hooklog/HookLog.svelte";
  import ViewerPanel from "./media/ViewerPanel.svelte";

  let isMaximized = $derived(layoutStore.maximizedPanel === "bottom");

  // 空状态引导步骤（精准表达打开 DAG 的操作路径）
  const dagGuideSteps = [
    {
      id: 1,
      icon: IconLayoutSidebarRightExpand,
      title: "展开右侧面板",
      desc: "点击右上角按钮，打开右侧的「蓝图」工作区。",
    },
    {
      id: 2,
      icon: IconBook2,
      title: "进入术语表",
      desc: "在「蓝图」中切换到「术语表」标签页。",
    },
    {
      id: 3,
      icon: IconSitemap,
      title: "定位 AI 设计的 DAG",
      desc: "找到以「.」（点）开头命名的条目——这类条目是 AI 设计生成的 DAG。",
    },
    {
      id: 4,
      icon: IconDotsVertical,
      title: "打开行操作菜单",
      desc: "点击该条目所在行左侧的「三个竖点」图标，展开操作菜单。",
    },
    {
      id: 5,
      icon: IconEye,
      title: "查看设计",
      desc: "在菜单中选择「查看设计」，对应的 DAG 图即会在此处渲染显示。",
    },
  ];
</script>

<div class="flex h-full min-h-0 flex-col border-t border-border/50 bg-muted/20">
  <PanelHeader
    {isMaximized}
    onToggleMaximize={() => layoutStore.toggleMaximizePanel("bottom")}
    onClose={() => layoutStore.closePanel("bottom")}
    showClose
    headerComponent={BottomPanelTabs}
  />

  <div class="flex-1 min-h-0">
    {#if bottomPanelStore.activeTab === "logger"}
      <HookLogViewer />
    {:else if bottomPanelStore.activeTab === "dag"}
      {#if flowStore.id}
        <div
          class="flex h-full w-full min-h-0 flex-col overflow-hidden bg-background text-foreground"
        >
          <FlowToolbar />
          <div class="relative min-h-0 flex-1">
            <FlowCanvas />
          </div>
        </div>
      {:else}
        <!--╭─────────────────────────────────────────────────────╮ -->
        <!-- │ [可抽取子组件 → DagEmptyState.svelte]                 │ -->
        <!-- │ 职责：DAG 面板未打开任何图时的空状态引导，含分步操作说明 │ -->
        <!-- ╰─────────────────────────────────────────────────────╯ -->
        <div
          class="flex h-full w-full min-h-0 items-center justify-center overflow-auto bg-background px-8 py-10"
        >
          <div
            class="animate-fade-in flex w-full max-w-2xl flex-col items-center"
          >
            <!-- 图标标识 -->
            <div
              class="mb-6 flex size-16 items-center justify-center rounded-2xl border border-border/50 bg-muted/40 text-primary shadow-sm"
            >
              <IconSitemap size={28} stroke={1.5} />
            </div>

            <!-- 主标题与说明 -->
            <h2
              class="text-2xl font-semibold tracking-tight text-foreground text-center"
            >
              当前尚未打开任何 DAG
            </h2>
            <p
              class="mt-3 max-w-md text-center text-sm text-muted-foreground leading-relaxed"
            >
              此处用于渲染 AI 设计生成的有向无环图（DAG）。
              请按以下步骤，从右侧「蓝图 · 术语表」中选择一个 DAG 并查看其设计，
              对应的图形结构即会在本区域显示。
            </p>

            <!-- 引导步骤卡片 -->
            <div class="mt-8 w-full space-y-3">
              {#each dagGuideSteps as step (step.id)}
                {@const Icon = step.icon}
                <div
                  class="group flex items-start gap-4 rounded-2xl border border-border/50 bg-muted/20 p-5 shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:bg-muted/40 hover:shadow-xl"
                >
                  <!-- 步骤序号 -->
                  <div
                    class="flex size-8 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-sm font-semibold text-primary"
                  >
                    {step.id}
                  </div>

                  <!-- 文案 -->
                  <div class="min-w-0 flex-1 space-y-1">
                    <div class="flex items-center gap-2">
                      <Icon
                        size={18}
                        stroke={1.5}
                        class="shrink-0 text-foreground/70"
                      />
                      <p class="text-sm font-medium text-foreground">
                        {step.title}
                      </p>
                    </div>
                    <p class="text-xs text-muted-foreground leading-relaxed">
                      {step.desc}
                    </p>
                  </div>
                </div>
              {/each}
            </div>

            <!-- 底部提示 -->
            <p class="mt-8 text-center text-xs text-muted-foreground/80">
              提示：本面板位于窗口底部，如需更大的操作空间，可点击右上角按钮将其最大化。
            </p>
          </div>
        </div>
        <!-- ╭─── / DagEmptyState ───╮ -->
      {/if}
    {:else if bottomPanelStore.activeTab === "media"}
      <ViewerPanel />
    {/if}
  </div>
</div>
