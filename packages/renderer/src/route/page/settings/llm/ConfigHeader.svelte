<script lang="ts">
  import { Button } from "$lib/components/ui/button";
  import {
    IconBrain,
    IconDeviceDesktop,
    IconPlus,
    IconServer,
  } from "@tabler/icons-svelte";

  let {
    providerCount = 0,
    totalModels = 0,
    localModels = 0,
    onAddProvider,
  }: {
    providerCount?: number;
    totalModels?: number;
    localModels?: number;
    onAddProvider?: () => void;
  } = $props();
</script>

<header class="flex flex-col gap-6 sm:flex-row sm:items-end sm:justify-between">
  <div class="space-y-2">
    <h1 class="text-2xl font-semibold tracking-tight lg:text-3xl">AIGC模型配置</h1>
    <p class="text-sm text-muted-foreground">
      管理 AIGC 服务提供商及其支持的模型
    </p>
    <div class="flex items-center gap-3 pt-1 text-xs text-muted-foreground">
      <span class="flex items-center gap-1.5">
        <IconServer size={14} stroke={1.5} />
        {providerCount} 个提供商
      </span>
      <span class="text-border">·</span>
      <span class="flex items-center gap-1.5">
        <IconBrain size={14} stroke={1.5} />
        {totalModels} 个模型
      </span>
      {#if localModels > 0}
        <span class="text-border">·</span>
        <span class="flex items-center gap-1.5">
          <IconDeviceDesktop size={14} stroke={1.5} />
          {localModels} 个本地
        </span>
      {/if}
    </div>
  </div>
  <Button
    class="gap-2 self-start rounded-xl sm:self-auto"
    onclick={() => onAddProvider?.()}
  >
    <IconPlus size={16} stroke={1.5} />
    添加提供商
  </Button>
</header>
