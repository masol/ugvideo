<!-- featured/rightside/bar.header.svelte -->
<script lang="ts">
  import { rightPanelStore } from "$lib/store/local/rightbar.store.svelte";

  let { isMaximized = false }: { isMaximized?: boolean } = $props();
</script>

<div class="flex items-center gap-2">
  {#if isMaximized}
    <span class="relative flex size-2 shrink-0">
      <span
        class="absolute inline-flex h-full w-full animate-ping rounded-full bg-primary/75"
      ></span>
      <span class="relative inline-flex size-2 rounded-full bg-primary"></span>
    </span>
  {/if}

  <div class="flex items-center gap-0.5">
    {#each rightPanelStore.tabs as tab (tab.id)}
      {@const isActive = rightPanelStore.activeTab === tab.id}
      <button
        class={[
          "flex items-center gap-1.5 rounded-xl px-2.5 py-1 text-xs transition-all duration-200",
          isActive
            ? isMaximized
              ? "bg-primary/15 text-primary font-medium dark:bg-primary/20"
              : "bg-accent text-foreground font-medium"
            : "text-muted-foreground hover:text-foreground hover:bg-accent/50",
        ]}
        onclick={() => (rightPanelStore.activeTab = tab.id)}
      >
        <tab.Icon class="size-3.5" />
        {tab.label}
      </button>
    {/each}
  </div>
</div>
