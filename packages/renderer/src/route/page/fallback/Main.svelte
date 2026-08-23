<script lang="ts">
  import { ScrollArea } from "$lib/components/ui/scroll-area";
  import { projectStore } from "$lib/store/project.svelte";
  import type { Snippet } from "svelte";
  import Dashboard from "./Dashboard/Dashboard.svelte";
  import WelcomeScreen from "./WelcomeScreen.svelte";

  interface Props {
    children?: Snippet;
  }
  let { children }: Props = $props();
</script>

<div class="h-full w-full">
  {#if children}
    {@render children()}
  {:else if projectStore.opened}
    <Dashboard />
  {:else}
    <!-- WelcomeScreen 需要滚动，所以用 ScrollArea -->
    <ScrollArea class="h-full">
      <WelcomeScreen />
    </ScrollArea>
  {/if}
</div>
