<!-- featured/rightside/bar.svelte -->
<script lang="ts">
  import PanelHeader from "$lib/components/pannel-header.svelte";
  import { ScrollArea } from "$lib/components/ui/scroll-area";
  import { rightPanelStore } from "$lib/store/local/rightbar.store.svelte";
  import { layoutStore } from "$lib/store/ui/layout.svelte";
  import autoAnimate from "@formkit/auto-animate";
  import BarHeader from "./bar.header.svelte";
  import ChatComponet from "./chat/Main.svelte";
  import Glossary from "./glossary/table.svelte";

  let isMaximized = $derived(layoutStore.maximizedPanel === "right");
</script>

<div class="flex h-full flex-col border-l border-border/50 bg-muted/20">
  <!-- ╭─────────────────────────────────────────────────────╮ -->
  <!-- │ PanelHeader：BarHeader 作为 headerComponent 传入    │ -->
  <!-- │ BarHeader 通过 store 切换 tab → bar 感知并切换内容  │ -->
  <!-- ╰─────────────────────────────────────────────────────╯ -->
  <PanelHeader
    {isMaximized}
    onToggleMaximize={() => layoutStore.toggleMaximizePanel("right")}
    onClose={() => layoutStore.closePanel("right")}
    showMaximize={true}
    showClose={true}
    headerComponent={BarHeader}
  />

  <!-- ╭─────────────────────────────────────────────────────╮ -->
  <!-- │ 内容区：assistant 铺满自管滚动；blueprint 走 ScrollArea │ -->
  <!-- │    assistant 不可包 ScrollArea / padding，否则输入框 │ -->
  <!-- │    会被一起滚动，无法固定在底部                       │ -->
  <!-- ╰─────────────────────────────────────────────────────╯ -->
  <div class="min-h-0 flex-1 overflow-hidden">
    {#if rightPanelStore.activeTab === "assistant"}
      <ChatComponet />
    {:else if rightPanelStore.activeTab === "blueprint"}
      <ScrollArea class="h-full">
        <div class="space-y-1 p-2 pt-1" use:autoAnimate>
          <Glossary />
        </div>
      </ScrollArea>
    {/if}
  </div>
</div>
