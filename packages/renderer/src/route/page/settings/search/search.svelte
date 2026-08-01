<script lang="ts">
  import { Separator } from "$lib/components/ui/separator";
  import { dialogStore } from "$lib/store/ui/dialog.svelte";
  import autoAnimate from "@formkit/auto-animate";
  import ConfigHeader from "./ConfigHeader.svelte";
  import EmptyState from "./EmptyState.svelte";
  import EngineConfigDialog from "./EngineConfigDialog.svelte";
  import ProviderCard from "./ProviderCard.svelte";
  import { searchStore } from "./searchstore.svelte";

  /* ═══ 派生统计 ═══ */
  let providerCount = $derived(searchStore.providers.length);
  let enabledProviders = $derived(searchStore.enabledProviders);
  let engineCount = $derived(searchStore.totalEngines);
  let enabledEngines = $derived(searchStore.enabledEngines);

  let openStates = $state<Record<string, boolean>>({});
  let hasProviders = $derived(searchStore.providers.length > 0);

  /* ═══ Actions ═══
     TODO: store bridge —— 把 searchStore 的 mutation 替换为真实 configStore 同步。 */

  async function openAddProvider() {
    // TODO: 调用真实的 ProviderConfigDialog
    // 这里用一个临时 inline prompt 占位
    await dialogStore.safeShow(EngineConfigDialog, {
      providerId: "tavily",
      onSave: async (engine) => {
        searchStore.upsertEngine(engine);
        return false;
      },
    });
  }

//   function openEditEngine(engineId: string) {
//     const engine = searchStore.engines.find((e) => e.id === engineId);
//     if (!engine) return;
//     dialogStore.safeShow(EngineConfigDialog, {
//       engine,
//       providerId: engine.providerId,
//       onSave: async (next) => {
//         searchStore.upsertEngine(next);
//         return false;
//       },
//     });
//   }
</script>

<div class="flex h-full w-full flex-col overflow-y-auto bg-background">
  <div class="space-y-8 p-8 lg:p-12">
    <ConfigHeader
      {providerCount}
      {enabledProviders}
      {engineCount}
      {enabledEngines}
      onAddProvider={openAddProvider}
    />

    {#if hasProviders}
      <Separator />
    {/if}

    <div class="space-y-6" use:autoAnimate>
      {#each searchStore.filteredProviders as provider (provider.id)}
        <ProviderCard
          {provider}
          engines={searchStore.visibleEnginesForProvider(provider.id)}
          open={openStates[provider.id] ?? false}
          onOpenChange={(v) => (openStates[provider.id] = v)}
          onEdit={openAddProvider}
          onAddEngine={openAddProvider}
          onRemove={() => searchStore.removeProvider(provider.id)}
          onToggleEnabled={(enabled) => {
            // TODO: store bridge
            void enabled;
          }}
        />
      {/each}

      {#if searchStore.isFiltering && searchStore.filteredProviders.length === 0}
        <EmptyState
          variant="filtered"
          onAction={() => searchStore.clearAllFilters()}
        />
      {/if}

      {#if !searchStore.isFiltering && !hasProviders}
        <EmptyState variant="empty" onAction={openAddProvider} />
      {/if}
    </div>
  </div>
</div>
