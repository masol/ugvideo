<script lang="ts">
  import { Button } from "$lib/components/ui/button";
  import {
    IconPlugConnected,
    IconPlus,
    IconShieldCheck,
    IconTool,
  } from "@tabler/icons-svelte";

  let {
    serverCount = 0,
    enabledCount = 0,
    toolCount = 0,
    autoApproveCount = 0,
    onAddServer,
  }: {
    serverCount?: number;
    enabledCount?: number;
    toolCount?: number;
    autoApproveCount?: number;
    onAddServer?: () => void;
  } = $props();
</script>

<header class="flex flex-col gap-6 sm:flex-row sm:items-end sm:justify-between">
  <div class="space-y-2">
    <h1 class="text-2xl font-semibold tracking-tight lg:text-3xl">MCP 服务</h1>
    <p class="text-sm text-muted-foreground">
      配置 Model Context Protocol 服务与工具权限
    </p>
    <div
      class="flex flex-wrap items-center gap-3 pt-1 text-xs text-muted-foreground"
    >
      <span class="flex items-center gap-1.5">
        <IconPlugConnected size={14} stroke={1.5} />
        {serverCount} 个服务
      </span>
      <span class="text-border">·</span>
      <span class="flex items-center gap-1.5">
        <IconShieldCheck size={14} stroke={1.5} />
        {enabledCount} 个启用
      </span>
      <span class="text-border">·</span>
      <span class="flex items-center gap-1.5">
        <IconTool size={14} stroke={1.5} />
        {toolCount} 个工具
      </span>
      {#if autoApproveCount > 0}
        <span class="text-border">·</span>
        <span class="flex items-center gap-1.5">
          <IconShieldCheck size={14} stroke={1.5} />
          {autoApproveCount} 个自动放行
        </span>
      {/if}
    </div>
  </div>
  <Button
    class="gap-2 self-start rounded-xl sm:self-auto"
    onclick={() => onAddServer?.()}
  >
    <IconPlus size={16} stroke={1.5} />
    添加 MCP 服务
  </Button>
</header>
