<script lang="ts">
  import { Badge } from "$lib/components/ui/badge";
  import { Button } from "$lib/components/ui/button";
  import * as Collapsible from "$lib/components/ui/collapsible";
  import { Input } from "$lib/components/ui/input";
  import { Label } from "$lib/components/ui/label";
  import { Separator } from "$lib/components/ui/separator";
  import { Switch } from "$lib/components/ui/switch";
  import autoAnimate from "@formkit/auto-animate";
  import {
    IconChevronDown,
    IconCloudOff,
    IconEye,
    IconEyeOff,
    IconKey,
    IconPlus,
    IconSettings,
    IconTrash,
    IconWorldSearch,
  } from "@tabler/icons-svelte";
  import EngineCard from "./EngineCard.svelte";
  import { searchStore } from "./searchstore.svelte";
  import type { SearchEngineConfig, SearchProviderConfig } from "./types";

  let {
    provider,
    engines,
    open = false,
    onOpenChange,
    onEdit,
    onAddEngine,
    onRemove,
    onToggleEnabled,
  }: {
    provider: SearchProviderConfig;
    engines: SearchEngineConfig[];
    open?: boolean;
    onOpenChange?: (v: boolean) => void;
    onEdit?: () => void;
    onAddEngine?: () => void;
    onRemove?: () => void;
    onToggleEnabled?: (enabled: boolean) => void;
  } = $props();

  const isDisabled = $derived(!provider.enabled);
  let keyVisible = $state(false);

  function handleToggle(checked: boolean) {
    provider.enabled = checked;
    onToggleEnabled?.(checked);
  }
</script>

<Collapsible.Root {open} onOpenChange={(v) => onOpenChange?.(v)}>
  <div
    class={[
      "rounded-2xl border transition-all duration-200",
      isDisabled
        ? "border-border/30 bg-card/60 shadow-none"
        : open
          ? "border-border/50 bg-card shadow-md"
          : "border-border/50 bg-card shadow-sm hover:shadow-lg",
    ]}
  >
    <Collapsible.Trigger>
      {#snippet child({ props })}
        <button
          {...props}
          class={[
            "flex w-full cursor-pointer items-center gap-4 p-6 text-left transition-colors duration-200 select-none",
            open ? "rounded-t-2xl" : "rounded-2xl",
            isDisabled ? "hover:bg-muted/15" : "hover:bg-muted/30",
          ]}
        >
          <div
            class={[
              "flex size-10 shrink-0 items-center justify-center rounded-xl transition-all duration-200",
              isDisabled ? "bg-muted" : "bg-primary/10",
            ]}
          >
            <IconWorldSearch
              size={20}
              stroke={1.5}
              class={isDisabled ? "text-muted-foreground/50" : "text-primary"}
            />
          </div>

          <div
            class={[
              "min-w-0 flex-1 transition-opacity duration-200",
              isDisabled && "opacity-50",
            ]}
          >
            <div class="flex flex-wrap items-center gap-2">
              <span
                class={[
                  "text-lg font-medium transition-all duration-200",
                  isDisabled &&
                    "line-through decoration-muted-foreground/40 decoration-1",
                ]}
              >
                {provider.name}
              </span>
              {#if isDisabled}
                <Badge
                  variant="secondary"
                  class="rounded-lg border-none bg-destructive/10 text-xs text-destructive"
                >
                  <IconCloudOff size={12} stroke={1.5} class="mr-1" />
                  已禁用
                </Badge>
              {/if}
              {#if provider.apiKey}
                <div
                  class="hidden items-center gap-1 text-xs text-muted-foreground sm:flex"
                >
                  <IconKey size={12} stroke={1.5} />
                  <span>已配置</span>
                </div>
              {/if}
            </div>
            <p
              class="mt-0.5 max-w-xs truncate text-xs text-muted-foreground sm:max-w-sm lg:max-w-md"
              title={provider.endpoint}
            >
              {provider.endpoint ?? "（未配置端点）"}
            </p>
          </div>

          <div class="flex shrink-0 items-center gap-3">
            <Switch
              checked={!isDisabled}
              onCheckedChange={handleToggle}
              class="scale-90"
            />
            <Badge variant="outline" class="rounded-lg text-xs">
              {engines.length} 个引擎
            </Badge>
            <div
              class={[
                "transition-transform duration-200",
                open && "rotate-180",
              ]}
            >
              <IconChevronDown
                size={20}
                stroke={1.5}
                class="text-muted-foreground"
              />
            </div>
          </div>
        </button>
      {/snippet}
    </Collapsible.Trigger>

    <Collapsible.Content>
      <div
        class={[
          "space-y-6 px-6 pb-6 transition-opacity duration-200",
          isDisabled && "opacity-60",
        ]}
      >
        <Separator />

        {#if isDisabled}
          <div
            class="flex items-center gap-4 rounded-xl border border-dashed border-destructive/20 bg-destructive/5 p-4"
          >
            <div
              class="flex size-8 shrink-0 items-center justify-center rounded-lg bg-destructive/10"
            >
              <IconCloudOff size={16} stroke={1.5} class="text-destructive" />
            </div>
            <p class="min-w-0 flex-1 text-sm text-muted-foreground">
              该搜索后端已被禁用，运行期不可用，配置仍然保留。
            </p>
          </div>
        {/if}

        <!-- 连接 + 密钥 -->
        <div class="space-y-4 rounded-2xl border border-border/50 p-6">
          <div class="flex items-center justify-between">
            <h3 class="flex items-center gap-2 text-base font-medium">
              <IconSettings
                size={16}
                stroke={1.5}
                class="text-muted-foreground"
              />
              连接配置
            </h3>
            <Button
              variant="outline"
              size="sm"
              class="gap-2 rounded-xl text-xs"
              onclick={() => onEdit?.()}
            >
              <IconSettings size={14} stroke={1.5} />
              编辑后端
            </Button>
          </div>

          <div class="space-y-2">
            <Label>API 密钥</Label>
            <div class="relative">
              <Input
                type={keyVisible ? "text" : "password"}
                value={provider.apiKey ?? ""}
                readonly
                placeholder="未配置"
                class="rounded-xl pr-9"
              />
              <button
                type="button"
                class="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground transition-all duration-200 hover:text-foreground"
                onclick={() => (keyVisible = !keyVisible)}
              >
                {#if keyVisible}
                  <IconEyeOff size={14} stroke={1.5} />
                {:else}
                  <IconEye size={14} stroke={1.5} />
                {/if}
              </button>
            </div>
          </div>
        </div>

        <Separator />

        <!-- Engines -->
        <div class="space-y-4">
          <div class="flex items-center justify-between">
            <h3
              class="text-xs font-medium uppercase tracking-wide text-muted-foreground"
            >
              引擎列表 ({engines.length})
            </h3>
            <Button
              variant="outline"
              size="sm"
              class="gap-1.5 rounded-xl text-xs"
              onclick={() => onAddEngine?.()}
              disabled={isDisabled}
            >
              <IconPlus size={14} stroke={1.5} />
              添加引擎
            </Button>
          </div>

          {#if engines.length > 0}
            <div class="grid grid-cols-1 gap-4" use:autoAnimate>
              {#each engines as engine (engine.id)}
                <EngineCard
                  {engine}
                  disabled={isDisabled}
                  onEdit={() => onAddEngine?.()}
                  onRemove={() => searchStore.removeEngine(engine.id)}
                />
              {/each}
            </div>
          {:else}
            <div
              class="flex flex-col items-center justify-center space-y-2 rounded-xl border border-dashed border-border/50 py-10"
            >
              <p class="text-sm text-muted-foreground">该后端尚未配置引擎</p>
            </div>
          {/if}
        </div>

        <Separator />

        <div class="flex items-center justify-between">
          <p class="text-xs text-muted-foreground">
            移除后该后端及其全部引擎配置将被永久删除
          </p>
          <Button
            variant="ghost"
            size="sm"
            class="gap-2 rounded-xl text-destructive hover:bg-destructive/10 hover:text-destructive"
            onclick={() => onRemove?.()}
          >
            <IconTrash size={14} stroke={1.5} />
            移除后端
          </Button>
        </div>
      </div>
    </Collapsible.Content>
  </div>
</Collapsible.Root>
