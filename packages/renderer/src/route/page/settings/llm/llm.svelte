<!-- llm.svelte -->
<script lang="ts">
  import { Button } from "$lib/components/ui/button";
  import { Separator } from "$lib/components/ui/separator";
  import { Switch } from "$lib/components/ui/switch";
  import { dialogStore } from "$lib/store/ui/dialog.svelte";
  import autoAnimate from "@formkit/auto-animate";
  import {
    IconArrowDown,
    IconArrowUp,
    IconFilterOff,
    IconSearch,
  } from "@tabler/icons-svelte";

  import { Label } from "$lib/components/ui/label/index";
  import { configStore } from "$lib/store/config.svelte";
  import { confirmStore } from "$lib/store/ui/confirm.svelte";
  import { PinyinFuseSearch, type SearchItem } from "$lib/utils/fuse";
  import type { ProviderConfig } from "$lib/utils/model/types";
  import { type Model, type Provider } from "@app/main/types";
  import ConfigHeader from "./ConfigHeader.svelte";
  import EmptyProvidersState from "./EmptyProvidersState.svelte";
  import ModelConfigDialog from "./model/ModelConfigDialog.svelte";
  import ProviderCard from "./ProviderCard.svelte";
  import ProviderConfigDialog from "./ProviderConfigDialog.svelte";
  import SearchFilterBar from "./SearchFilterBar.svelte";
  import { searchStore } from "./searchstore.svelte";
  /* eslint-disable svelte/prefer-svelte-reactivity */

  let openStates = $state<Record<string, boolean>>({});
  let totalModels = $derived(configStore.totalModels);
  let providerCount = $derived(configStore.providers.length);
  let hasProviders = $derived(configStore.providers.length > 0);

  // 排序与显示控制
  let sortOrder = $state<"asc" | "desc">("asc");
  let showDisabled = $state(true);

  const idCollator = new Intl.Collator(undefined, {
    numeric: true,
    sensitivity: "base",
  });

  function compareIds(a: string, b: string, order: "asc" | "desc"): number {
    const r = idCollator.compare(a, b);
    return order === "asc" ? r : -r;
  }

  function toggleSortOrder() {
    sortOrder = sortOrder === "asc" ? "desc" : "asc";
  }

  // ---------- Fuse 索引与文本搜索 ----------
  const searchItems = $derived.by(() => {
    const items: SearchItem[] = [];
    for (const p of configStore.providers) {
      items.push({ id: `provider:${p.id}`, text: p.id });
      for (const m of p.models) {
        items.push({ id: `model:${p.id}:${m.id}`, text: m.id });
      }
    }
    return items;
  });

  const fuseIndex = $derived(new PinyinFuseSearch(searchItems));

  const fuseResult = $derived.by(() => {
    const q = searchStore.searchQuery.trim();
    if (!q) {
      const providerIds = new Set(configStore.providers.map((p) => p.id));
      const modelKeys = new Set<string>();
      for (const p of configStore.providers) {
        for (const m of p.models) modelKeys.add(`${p.id}:${m.id}`);
      }
      return { providerIds, modelKeys };
    }
    const ids = fuseIndex.search(q);
    const providerIds = new Set<string>();
    const modelKeys = new Set<string>();
    for (const raw of ids) {
      const sid = String(raw);
      if (sid.startsWith("provider:")) {
        providerIds.add(sid.slice(9));
      } else if (sid.startsWith("model:")) {
        const rest = sid.slice(6);
        const colonIdx = rest.indexOf(":");
        if (colonIdx > 0) {
          const pid = rest.slice(0, colonIdx);
          providerIds.add(pid);
          modelKeys.add(`${pid}:${rest.slice(colonIdx + 1)}`);
        }
      }
    }
    return { providerIds, modelKeys };
  });

  // ---------- 辅助过滤函数 ----------
  function modelMatchesTab(m: Model, tab: string | null): boolean {
    if (!tab) return true;
    return m.abilities.includes(tab as never);
  }

  function abilityMatch(m: Model, filters: string[]): boolean {
    if (filters.length === 0) return true;
    return m.abilities.some((a) => filters.includes(a));
  }

  // ---------- 过滤后的提供商 ----------
  let filteredProviders = $derived.by(() => {
    const tab = searchStore.activeFunctionTab;
    const abilityFilter = searchStore.activeAbilityFilters;

    let list = configStore.providers.filter((p) => {
      // 文本搜索匹配
      const textMatch = fuseResult.providerIds.has(p.id);
      if (!textMatch) return false;

      // 隐藏已禁用提供商的控制
      if (!showDisabled && p.disabled) return false;

      if (!tab && abilityFilter.length === 0) return true;
      return p.models.some(
        (m) => modelMatchesTab(m, tab) && abilityMatch(m, abilityFilter),
      );
    });

    return [...list].sort((a, b) => compareIds(a.id, b.id, sortOrder));
  });

  function getVisibleModels(provider: Provider): Model[] {
    const tab = searchStore.activeFunctionTab;
    const abilityFilter = searchStore.activeAbilityFilters;
    const q = searchStore.searchQuery.trim();

    let list = provider.models.filter((m) => {
      const textMatch = q
        ? fuseResult.modelKeys.has(`${provider.id}:${m.id}`)
        : true;
      if (!textMatch) return false;
      return modelMatchesTab(m, tab) && abilityMatch(m, abilityFilter);
    });

    return [...list].sort((a, b) => compareIds(a.id, b.id, sortOrder));
  }

  let filteredModelCount = $derived(
    filteredProviders.reduce((s, p) => s + getVisibleModels(p).length, 0),
  );

  // ---------- 提供商与模型操作（不变）----------
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
          if (provider?.id && provider.id !== config.id) {
            const oldProvider = configStore.findProviderById(provider.id);
            if (oldProvider) {
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
      { size: "xl" },
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
    const existingModelIds = provider.models
      .map((m) => m.id)
      .filter((id) => id !== oldId);
    await dialogStore.safeShow(
      ModelConfigDialog,
      {
        model,
        existingModelIds,
        fetchCtx: { baseUrl: provider.baseUrl, apiKey: provider.apiKey },
        onSave: async (next: Model): Promise<boolean> => {
          if (oldId && oldId !== next.id) {
            await configStore.removeModel(pid, oldId);
          }
          await configStore.upsertModel(pid, next);
          return false;
        },
      },
      { size: "xl" },
    );
  }
</script>

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
      <!-- 排序切换 + 隐藏/显示已禁用开关 + 分隔线 -->
      <div class="flex items-center gap-3 h-5">
        <button
          type="button"
          class="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors duration-200 rounded-lg px-2 py-1 border border-border/50 bg-background"
          onclick={toggleSortOrder}
          aria-label={sortOrder === "asc"
            ? "当前升序，点击切换为降序"
            : "当前降序，点击切换为升序"}
        >
          {#if sortOrder === "asc"}
            <IconArrowUp size={14} stroke={1.5} />
            <span>A → Z</span>
          {:else}
            <IconArrowDown size={14} stroke={1.5} />
            <span>Z → A</span>
          {/if}
        </button>

        <Separator orientation="vertical" class="" />

        <!-- 隐藏/显示已禁用提供商开关 -->
        <div class="flex items-center gap-2 text-xs text-muted-foreground">
          <!-- 赋予 role="button" 使其成为交互元素；tabindex 可聚焦 -->
          <Label
            for="setting-disabled-ctrl"
            class="cursor-pointer"
            role="button"
            tabindex={0}
            onclick={() => (showDisabled = !showDisabled)}
            onkeydown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                showDisabled = !showDisabled;
              }
            }}
          >
            {showDisabled ? "隐藏" : "显示"}已禁用
          </Label>

          <Switch
            id="setting-disabled-ctrl"
            bind:checked={showDisabled}
            class="shrink-0"
          />
        </div>

        <Separator class="flex-1" />
      </div>
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
