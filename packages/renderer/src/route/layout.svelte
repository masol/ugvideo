<!-- src/route/layout.svelte -->
<script lang="ts">
  import * as Resizable from "$lib/components/ui/resizable";
  import * as Tooltip from "$lib/components/ui/tooltip";
  import { layoutStore } from "$lib/store/ui/layout.svelte";
  import { routerStore } from "$lib/store/ui/route.svelte";
  import Router from "svelte-spa-router";
  import ActivityBar from "./featured/activity.svelte";
  import BottomBar from "./featured/bottom/bar.svelte";
  import HeaderBar from "./featured/header-bar.svelte";
  import LeftSidebar from "./featured/leftside/bar.svelte";
  import RightSidebar from "./featured/rightside/bar.svelte";
  import StatusBar from "./featured/status.svelte";
</script>

<!--══════════════════════════════════════════════════════════════ -->
<!--ROOT LAYOUT                                                  -->
<!-- ══════════════════════════════════════════════════════════════ -->
<Tooltip.Provider delayDuration={300}>
  <div class="flex w-full h-full flex-col bg-background">
    <!-- HeaderBar：固定在顶部 -->
    <HeaderBar />

    <!-- 内容区域：Activity Bar + Panels -->
    <div class="flex flex-1 overflow-hidden">
      <ActivityBar></ActivityBar>
      <!-- ╭─── / ActivityBar ───╮ -->

      <!-- ══════════════════════════════════════════════ -->
      <!--  Resizable Panel Group-->
      <!-- ══════════════════════════════════════════════ -->
      <div class="flex-1 min-w-0 min-h-0">
        {#key layoutStore.horizontalKey}
          <Resizable.PaneGroup direction="horizontal" class="h-full">
            <!-- ── Left Sidebar Pane ── -->
            {#if layoutStore.isLeftOpen}
              <Resizable.Pane
                defaultSize={layoutStore.isAnyMaximized &&
                layoutStore.maximizedPanel === "left"
                  ? 100
                  : 20}
                minSize={14}
                maxSize={layoutStore.isAnyMaximized ? 100 : 45}
              >
                <LeftSidebar></LeftSidebar>
              </Resizable.Pane>
              {#if !layoutStore.isAnyMaximized}
                <Resizable.Handle
                  class="w-px bg-transparent hover:bg-primary/30 active:bg-primary/50 transition-colors duration-200"
                />
              {/if}
            {/if}

            <!-- ── Center Column (Editor + Bottom Panel) ── -->
            {#if layoutStore.showMainEditor || layoutStore.maximizedPanel === "bottom"}
              <Resizable.Pane
                defaultSize={layoutStore.maximizedPanel === "bottom"
                  ? 100
                  : undefined}
                minSize={30}
              >
                {#key layoutStore.verticalKey}
                  <Resizable.PaneGroup direction="vertical" class="h-full">
                    <!-- Main Editor Area -->
                    {#if layoutStore.showMainEditor}
                      <Resizable.Pane minSize={20}>
                        <div class="h-full w-full overflow-hidden">
                          <Router routes={routerStore.routes} />
                        </div>
                      </Resizable.Pane>
                    {/if}
                    <!-- Bottom Panel -->
                    {#if layoutStore.showBottom}
                      {#if layoutStore.showMainEditor}
                        <Resizable.Handle
                          class="h-px bg-transparent hover:bg-primary/30 active:bg-primary/50 transition-colors duration-200"
                        />
                      {/if}
                      <Resizable.Pane
                        defaultSize={layoutStore.maximizedPanel === "bottom"
                          ? 100
                          : 30}
                        minSize={15}
                        maxSize={layoutStore.maximizedPanel === "bottom"
                          ? 100
                          : 80}
                      >
                        <BottomBar></BottomBar>
                        <!-- ╭─── / BottomPanel ───╮ -->
                      </Resizable.Pane>
                    {/if}
                  </Resizable.PaneGroup>
                {/key}
              </Resizable.Pane>
            {/if}

            <!-- ── Right Sidebar Pane ── -->
            {#if layoutStore.showRight}
              {#if !layoutStore.isAnyMaximized}
                <Resizable.Handle
                  class="w-px bg-transparent hover:bg-primary/30 active:bg-primary/50 transition-colors duration-200"
                />
              {/if}
              <Resizable.Pane
                defaultSize={layoutStore.isAnyMaximized &&
                layoutStore.maximizedPanel === "right"
                  ? 100
                  : 18}
                minSize={12}
                maxSize={layoutStore.isAnyMaximized ? 100 : 40}
              >
                <!-- ╭─── / RightSidebar ───╮ -->
                <RightSidebar />
              </Resizable.Pane>
            {/if}
          </Resizable.PaneGroup>
        {/key}
      </div>
    </div>
    <!-- ══════════════════════════════════════════════ -->
    <!--  Status Bar (底部状态栏)                -->
    <!-- ══════════════════════════════════════════════ -->
    <StatusBar />
  </div>
</Tooltip.Provider>
