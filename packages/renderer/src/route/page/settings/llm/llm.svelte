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

  /**
   * 统一的 id 字母升序比较器：
   * · numeric 让 "gpt-4" 排在 "gpt-40" 之前（自然序）
   * · sensitivity:"base" 忽略大小写差异，保证 "Qwen" 与 "qwen" 相邻
   */
  const idCollator = new Intl.Collator(undefined, {
    numeric: true,
    sensitivity: "base",
  });
  function byId(a: { id: string }, b: { id: string }): number {
    return idCollator.compare(a.id, b.id);
  }

  /**
   * 已存在的所有 Provider id（用于在 ProviderConfigDialog 内检测重名）。
   * 编辑模式下需要排除"自己"当前的 id，避免自我误判。
   */
  function buildExistingProviderIds(excludeId?: string): string[] {
    return configStore.providers
      .map((p) => p.id)
      .filter((id) => id !== excludeId);
  }

  async function addProvider(provider?: Partial<ProviderConfig>) {
    await dialogStore.safeShow(
      ProviderConfigDialog,
      {
        config: provider,
        existingProviderIds: buildExistingProviderIds(provider?.id),
        onSave: async (config: ProviderConfig): Promise<void> => {
          // 检测改名：旧 id 存在且与新 id 不同
          if (provider?.id && provider.id !== config.id) {
            const oldProvider = configStore.findProviderById(provider.id);
            if (oldProvider) {
              // 保留旧 Provider 的所有模型，迁移到新 id 下
              await configStore.upsertProvider({
                ...config,
                models: oldProvider.models,
              });
              await configStore.removeProvider(provider.id);
              return;
            }
          }
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
    // 该提供商下已存在的模型 id（编辑模式排除自己），交给对话框拦截重名
    const existingModelIds = provider.models
      .map((m) => m.id)
      .filter((id) => id !== oldId);

    await dialogStore.safeShow(
      ModelConfigDialog,
      {
        model,
        existingModelIds,
        // baseUrl 是稳定端点锚点，对话框据此反查 preset 静态模型清单
        fetchCtx: { baseUrl: provider.baseUrl, apiKey: provider.apiKey },
        onSave: async (next: Model): Promise<boolean> => {
          // 对话框已保证 next.id 不与其他模型冲突，此处只需处理改名删除旧条目
          if (oldId && oldId !== next.id) {
            await configStore.removeModel(pid, oldId);
          }
          await configStore.upsertModel(pid, next);
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

    let list: Model[];
    if (!q && !tab && !hasAbilityFilter) {
      list = provider.models;
    } else {
      const providerNameMatch = !q || provider.id.toLowerCase().includes(q);
      list = provider.models.filter((m) => {
        const modelTextMatch =
          !q || providerNameMatch || m.id.toLowerCase().includes(q);
        const tabMatch = modelMatchesTab(m, tab);
        const abilityMatch =
          !hasAbilityFilter ||
          m.abilities.some((a) => searchStore.activeAbilityFilters.includes(a));
        return modelTextMatch && tabMatch && abilityMatch;
      });
    }

    // 字母升序（不改动原数组）
    return [...list].sort(byId);
  }

  let filteredProviders = $derived.by(() => {
    const q = searchStore.searchQuery.toLowerCase().trim();
    const tab = searchStore.activeFunctionTab;
    const hasAbilityFilter = searchStore.activeAbilityFilters.length > 0;

    let list: Provider[];
    if (!q && !tab && !hasAbilityFilter) {
      list = configStore.providers;
    } else {
      list = configStore.providers.filter((p) => {
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
            m.abilities.some((a) =>
              searchStore.activeAbilityFilters.includes(a),
            );
          return modelTextMatch && tabMatch && abilityMatch;
        });

        if (!tab && !hasAbilityFilter)
          return providerTextMatch || hasMatchingModel;
        return hasMatchingModel;
      });
    }

    // 字母升序（不改动原数组）
    return [...list].sort(byId);
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
