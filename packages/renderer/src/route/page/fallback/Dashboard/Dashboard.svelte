<!-- Dashboard/Dashboard.svelte -->
<script lang="ts">
  import { dashboardStore } from "$lib/store/dashboard.svelte";
  import autoAnimate from "@formkit/auto-animate";
  import ChatMain from "../chat/Main.svelte";
  import DashboardHeader from "./DashboardHeader.svelte";
  import InfoBlocksGrid from "./InfoBlocksGrid.svelte";
  import RunControlCard from "./RunControlCard.svelte";
</script>

<!-- Dashboard 必须是 h-full，且使用 flex-col 布局 -->
<div class="flex h-full w-full flex-col overflow-hidden bg-background">
  <!-- 头部和内容区域使用内边距包裹 -->
  <div class="flex flex-col gap-6 p-4 sm:p-8 lg:p-12">
    <DashboardHeader />
  </div>

  <!-- 内容区域：flex-1 占满剩余空间 -->
  <section
    class="flex flex-1 min-h-0 flex-col gap-6 px-4 sm:px-8 lg:px-12 pb-4 sm:pb-8 lg:pb-12"
    use:autoAnimate
  >
    {#if dashboardStore.viewMode === "control"}
      <div class="overflow-y-auto">
        <div class="space-y-6">
          <RunControlCard />
          <InfoBlocksGrid />
        </div>
      </div>
    {:else}
      <!-- 🔧 聊天模式：必须占满剩余空间 -->
      <div
        class="flex-1 min-h-0 overflow-hidden rounded-2xl border border-border/50 bg-card shadow-sm animate-fade-in"
      >
        <ChatMain />
      </div>
    {/if}
  </section>
</div>
