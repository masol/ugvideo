<!-- Dashboard/DashboardHeader.svelte -->
<script lang="ts">
  import { Badge } from "$lib/components/ui/badge";
  import * as ToggleGroup from "$lib/components/ui/toggle-group";
  import { dashboardStore } from "$lib/store/dashboard.svelte";
  import { projectStore } from "$lib/store/project.svelte";
  import {
    IconAlertTriangle,
    IconBolt,
    IconCircleDashed,
    IconClock,
    IconLoader2,
    IconMessage,
    IconPlayerPlay,
  } from "@tabler/icons-svelte";

  function fmtTime(s: number) {
    const m = Math.floor(s / 60);
    const ss = s % 60;
    return `${String(m).padStart(2, "0")}:${String(ss).padStart(2, "0")}`;
  }

  function handleModeChange(value: string | undefined) {
    if (value === "control" || value === "chat") {
      dashboardStore.viewMode = value;
    }
  }
</script>

<header class="flex items-center justify-between">
  <div class="flex items-center gap-4">
    <div
      class="flex size-12 items-center justify-center rounded-2xl border border-border/50 bg-card shadow-sm"
    >
      <IconBolt size={24} stroke={1.5} class="text-primary" />
    </div>
    <div class="space-y-1">
      <h1 class="text-2xl font-semibold tracking-tight lg:text-3xl">
        {projectStore.activity?.header.title}
      </h1>
      <p class="text-sm text-muted-foreground">
        {projectStore.activity?.header.detail}
      </p>
    </div>
  </div>

  <div class="flex items-center gap-3">
    <!-- 移动端隐藏状态徽章 -->
    <Badge
      variant="outline"
      class="hidden gap-2 rounded-xl border-border/50 px-3 py-1.5 text-xs font-medium sm:flex"
    >
      {#if dashboardStore.runState === "idle"}
        <IconCircleDashed
          size={14}
          stroke={1.5}
          class="text-muted-foreground"
        />
      {:else if dashboardStore.runState === "running"}
        <IconLoader2 size={14} stroke={1.5} class="animate-spin text-primary" />
      {:else}
        <IconAlertTriangle size={14} stroke={1.5} class="text-amber-500" />
      {/if}
      <span>状态：{dashboardStore.statusLabel}</span>
    </Badge>

    {#if dashboardStore.runState !== "idle"}
      <Badge
        variant="outline"
        class="hidden gap-2 rounded-xl border-border/50 px-3 py-1.5 text-xs sm:flex"
      >
        <IconClock size={14} stroke={1.5} class="text-muted-foreground" />
        <span class="font-mono">{fmtTime(dashboardStore.elapsedSeconds)}</span>
      </Badge>
    {/if}

    <div class="hidden h-5 w-px bg-border/50 sm:block"></div>

    <ToggleGroup.Root
      type="single"
      value={dashboardStore.viewMode}
      onValueChange={handleModeChange}
      class="rounded-xl border border-border/50 bg-muted/30 p-1"
    >
      <ToggleGroup.Item
        value="control"
        aria-label="切换到主控模式"
        class="gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition-all duration-200 data-[state=on]:bg-background data-[state=on]:text-foreground data-[state=on]:shadow-sm"
      >
        <IconPlayerPlay size={14} stroke={1.5} />
        <span class="hidden sm:inline">主控</span>
      </ToggleGroup.Item>
      <ToggleGroup.Item
        value="chat"
        aria-label="切换到对话模式"
        class="gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition-all duration-200 data-[state=on]:bg-background data-[state=on]:text-foreground data-[state=on]:shadow-sm"
      >
        <IconMessage size={14} stroke={1.5} />
        <span class="hidden sm:inline">对话</span>
      </ToggleGroup.Item>
    </ToggleGroup.Root>
  </div>
</header>
