<script lang="ts">
  /* eslint-disable @typescript-eslint/no-explicit-any */

  import {
    IconAlertTriangle,
    IconMedicineSyrup,
    IconSparkleHighlight,
  } from "@tabler/icons-svelte";
  import type { Component } from "svelte";
  import { bottomPanelStore } from "./bar.store.svelte";

  const iconMap: Record<string, Component<any>> = {
    logger: IconAlertTriangle as unknown as Component<any>,
    dag: IconSparkleHighlight as unknown as Component<any>,
    media: IconMedicineSyrup as unknown as Component<any>,
  };
</script>

<div class="flex items-center gap-0.5">
  {#each bottomPanelStore.tabs as tab (tab.id)}
    {@const Icon = iconMap[tab.id]}
    <button
      class={[
        "flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs transition-all duration-200",
        bottomPanelStore.activeTab === tab.id
          ? "bg-accent/70 text-foreground font-medium"
          : "text-muted-foreground hover:text-foreground hover:bg-accent/40",
      ]}
      onclick={() => bottomPanelStore.setActiveTab(tab.id)}
    >
      {#if Icon}
        <Icon class="size-3.5" />
      {/if}
      {tab.label}
      {#if tab.badge > 0}
        <span
          class="flex size-4 items-center justify-center rounded-full bg-primary text-[10px] text-primary-foreground"
        >
          {tab.badge}
        </span>
      {/if}
    </button>
  {/each}
</div>
