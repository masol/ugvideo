<script lang="ts">
  import { Separator } from "$lib/components/ui/separator";
  import autoAnimate from "@formkit/auto-animate";
  import ConfigHeader from "./ConfigHeader.svelte";
  import ProviderRow from "./ProviderRow.svelte";
  import { searchStore } from "./searchstore.svelte";
  import type { SearchProviderConfig } from "./types";

  let providerCount = $derived(searchStore.providers.length);
  let enabledProviders = $derived(searchStore.enabledProviders);

  function handleAdd(type: SearchProviderConfig["type"]) {
    searchStore.addProvider(type);
  }

  function handleUpdate(id: string, updates: Partial<SearchProviderConfig>) {
    searchStore.updateProvider(id, updates);
  }

  function handleRemove(id: string) {
    searchStore.removeProvider(id);
  }
</script>

<div class="flex h-full w-full flex-col overflow-y-auto bg-background">
  <div class="space-y-8 p-8 lg:p-12">
    <ConfigHeader
      {providerCount}
      {enabledProviders}
      onAdd={(type) => handleAdd(type)}
    />

    <Separator />

    <div class="space-y-4" use:autoAnimate>
      {#each searchStore.providers as provider (provider.id)}
        <ProviderRow
          {provider}
          onUpdate={(updates) => handleUpdate(provider.id, updates)}
          onRemove={() => handleRemove(provider.id)}
        />
      {/each}
    </div>
  </div>
</div>
