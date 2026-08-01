<!-- llm.svelte -->
<script lang="ts">
  import { Button } from "$lib/components/ui/button";
  import { Separator } from "$lib/components/ui/separator";
  import { dialogStore } from "$lib/store/ui/dialog.svelte";
  import autoAnimate from "@formkit/auto-animate";
  import { IconFilterOff, IconSearch } from "@tabler/icons-svelte";

  import { configStore } from "$lib/store/config.svelte";
  import { confirmStore } from "$lib/store/ui/confirm.svelte";
  import type { ProviderConfig } from "$lib/utils/model/types";
  import { type Model, type Provider } from "@app/main/types";
  import ConfigHeader from "./ConfigHeader.svelte";
  import EmptyProvidersState from "./EmptyProvidersState.svelte";
  import ModelConfigDialog from "./model/ModelConfigDialog.svelte";
  import ProviderCard from "./ProviderCard.svelte";
  import ProviderConfigDialog from "./ProviderConfigDialog.svelte";
  import SearchFilterBar from "./SearchFilterBar.svelte";
  import { searchStore } from "./searchstore.svelte";

  let openStates = $state<Record<string, boolean>>({});
  let totalModels = $derived(configStore.totalModels);
  let providerCount = $derived(configStore.providers.length);
  let hasProviders = $derived(configStore.providers.length > 0);

  async function addProvider(provider?: Partial<ProviderConfig>) {
    await dialogStore.safeShow(
      ProviderConfigDialog,
      {
        config: provider,
        onSave: async (config: ProviderConfig): Promise<void> => {
          configStore.upsertProvider({ ...config, models: [] });
        },
      },
      {
        size: "xl",
      },
    );
  }

  async function handleRemoveModel(providerId: string, modelId: string) {
    const provider = configStore.providers.find((p) => p.id === providerId);
    const model = provider?.models.find((m) => m.id === modelId);
    const displayName = model?.id ?? modelId;

    const confirmed = await confirmStore.request({
      title: "移除模型",
      message: `确定要移除「${displayName}」吗？此操作不可撤销。`,
      confirmLabel: "确认移除",
      destructive: true,
    });

    if (!confirmed) return;
    await configStore.removeModel(providerId, modelId);
  }

  async function handleRemoveProvider(providerId: string) {
    const provider = configStore.providers.find((p) => p.id === providerId);
    const count = provider?.models.length ?? 0;
    const displayName = provider?.id ?? providerId;

    const confirmed = await confirmStore.request({
      title: "移除提供商",
      message: `确定要移除「${displayName}」及其 ${count} 个模型吗？此操作不可撤销。`,
      confirmLabel: "确认移除",
      destructive: true,
    });

    if (!confirmed) return;
    await configStore.removeProvider(providerId);
  }

  async function upsertModel(pid: string, model?: Model): Promise<void> {
    const provider = configStore.findProviderById(pid);
    if (!provider) {
      throw new Error(`请求增加的模型，其所属供应商${pid}无效。`);
    }
    const oldId = model?.id;
    await dialogStore.safeShow(
      ModelConfigDialog,
      {
        model,
        fetchCtx: { baseUrl: provider.baseUrl, apiKey: provider.apiKey },
        onSave: async (model: Model): Promise<boolean> => {
          if (oldId && oldId !== model.id) {
            const overwittenModel = configStore.findModelById(pid, model.id);
            if (overwittenModel) {
              const confirmed = await confirmStore.request({
                title: "额外删除确认",
                message: `本次修改，将删除旧模型${oldId},同时覆盖已有的模型${model.id},确定继续吗？`,
              });
              if (!confirmed) return true;
            }
            await configStore.removeModel(pid, oldId);
          }
          await configStore.upsertModel(pid, model);
          return false;
        },
      },
      {
        size: "xl",
      },
    );
  }

  function modelMatchesTab(m: Model, tab: string | null): boolean {
    if (!tab) return true;
    return m.abilities.includes(tab as never);
  }

  function getVisibleModels(provider: Provider): Model[] {
    const q = searchStore.searchQuery.toLowerCase().trim();
    const tab = searchStore.activeFunctionTab;
    const hasAbilityFilter = searchStore.activeAbilityFilters.length > 0;
    if (!q && !tab && !hasAbilityFilter) return provider.models;

    const providerNameMatch = !q || provider.id.toLowerCase().includes(q);

    return provider.models.filter((m) => {
      const modelTextMatch =
        !q || providerNameMatch || m.id.toLowerCase().includes(q);
      const tabMatch = modelMatchesTab(m, tab);
      const abilityMatch =
        !hasAbilityFilter ||
        m.abilities.some((a) => searchStore.activeAbilityFilters.includes(a));
      return modelTextMatch && tabMatch && abilityMatch;
    });
  }

  let filteredProviders = $derived.by(() => {
    const q = searchStore.searchQuery.toLowerCase().trim();
    const tab = searchStore.activeFunctionTab;
    const hasAbilityFilter = searchStore.activeAbilityFilters.length > 0;
    if (!q && !tab && !hasAbilityFilter) return configStore.providers;

    return configStore.providers.filter((p) => {
      const providerTextMatch =
        !q ||
        p.id.toLowerCase().includes(q) ||
        p.baseUrl.toLowerCase().includes(q);

      const hasMatchingModel = p.models.some((m) => {
        const modelTextMatch =
          !q || providerTextMatch || m.id.toLowerCase().includes(q);
        const tabMatch = modelMatchesTab(m, tab);
        const abilityMatch =
          !hasAbilityFilter ||
          m.abilities.some((a) => searchStore.activeAbilityFilters.includes(a));
        return modelTextMatch && tabMatch && abilityMatch;
      });

      if (!tab && !hasAbilityFilter)
        return providerTextMatch || hasMatchingModel;
      return hasMatchingModel;
    });
  });

  let filteredModelCount = $derived(
    filteredProviders.reduce((s, p) => s + getVisibleModels(p).length, 0),
  );
</script>

<!-- ════════════════════════════════════════════════════════════
     Template
     ════════════════════════════════════════════════════════════ -->
<div class="flex h-full w-full flex-col overflow-y-auto bg-background">
  <div class="space-y-8 p-8 lg:p-12">
    <ConfigHeader
      {providerCount}
      {totalModels}
      onAddProvider={() => addProvider(undefined)}
    />

    {#if hasProviders}
      <SearchFilterBar
        filteredProviderCount={filteredProviders.length}
        {filteredModelCount}
      />
      <Separator />
    {/if}

    <div class="space-y-6" use:autoAnimate>
      {#each filteredProviders as provider (provider.id)}
        <ProviderCard
          {provider}
          visibleModels={getVisibleModels(provider)}
          open={openStates[provider.id] ?? false}
          onOpenChange={(v) => {
            openStates[provider.id] = v;
          }}
          onEditConfig={() => addProvider(provider)}
          onAddModel={async (model?: Model) => {
            await upsertModel(provider.id, model);
          }}
          onToggleEnabled={async () => {
            await configStore.upsertProvider(provider);
          }}
          onRemoveModel={(modelId) => handleRemoveModel(provider.id, modelId)}
          onRemoveProvider={() => handleRemoveProvider(provider.id)}
        />
      {/each}

      {#if searchStore.isFiltering && filteredProviders.length === 0}
        <div
          class="flex animate-fade-in flex-col items-center justify-center space-y-6 py-20"
        >
          <div
            class="flex size-14 items-center justify-center rounded-2xl bg-muted"
          >
            <IconSearch size={22} stroke={1.5} class="text-muted-foreground" />
          </div>
          <div class="space-y-2 text-center">
            <h3 class="text-lg font-medium">未找到匹配结果</h3>
            <p class="text-sm text-muted-foreground">
              尝试更换搜索关键词或调整筛选条件
            </p>
          </div>
          <Button
            variant="outline"
            class="gap-2 rounded-xl"
            onclick={() => searchStore.clearAllFilters()}
          >
            <IconFilterOff size={16} stroke={1.5} />
            清除全部筛选
          </Button>
        </div>
      {/if}

      {#if !searchStore.isFiltering && configStore.providers.length === 0}
        <EmptyProvidersState onAddProvider={addProvider} />
      {/if}
    </div>
  </div>
</div>
