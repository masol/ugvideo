<!--
  工具权限编辑器
  职责：展示某 MCP 服务下的工具清单，并允许切换"自动放行"。
  内部不感知 store；通过 props.onToggle 回调。
-->
<script lang="ts">
  import { Badge } from "$lib/components/ui/badge";
  import { Switch } from "$lib/components/ui/switch";
  import autoAnimate from "@formkit/auto-animate";
  import {
    IconAlertTriangle,
    IconShieldCheck,
    IconTool,
  } from "@tabler/icons-svelte";

  type Tool = { name: string; description: string; dangerous: boolean };

  let {
    tools,
    autoApprove = [],
    onToggle,
  }: {
    tools: Tool[];
    autoApprove?: string[];
    onToggle?: (toolName: string) => void;
  } = $props();

  function isApproved(name: string): boolean {
    return autoApprove.includes(name);
  }
</script>

<div class="space-y-3" use:autoAnimate>
  <div class="flex items-center gap-2 text-xs text-muted-foreground">
    <IconTool size={14} stroke={1.5} />
    <span>工具列表 · 自动放行可绕过运行时确认</span>
  </div>

  {#each tools as tool (tool.name)}
    {@const approved = isApproved(tool.name)}
    <div
      class={[
        "flex items-start gap-3 rounded-xl border p-3 transition-all duration-200",
        approved
          ? "border-primary/30 bg-primary/5"
          : "border-border/50 bg-background hover:border-border hover:shadow-sm",
      ]}
    >
      <div
        class={[
          "flex size-8 shrink-0 items-center justify-center rounded-lg",
          tool.dangerous ? "bg-destructive/10" : "bg-muted",
        ]}
        title={tool.dangerous ? "危险操作" : "安全操作"}
      >
        {#if tool.dangerous}
          <IconAlertTriangle size={14} stroke={1.5} class="text-destructive" />
        {:else}
          <IconShieldCheck
            size={14}
            stroke={1.5}
            class="text-muted-foreground"
          />
        {/if}
      </div>

      <div class="min-w-0 flex-1 space-y-1">
        <div class="flex flex-wrap items-center gap-2">
          <p class="truncate font-mono text-xs font-medium">
            {tool.name}
          </p>
          {#if tool.dangerous}
            <Badge
              variant="secondary"
              class="rounded-lg border-none bg-destructive/10 text-xs text-destructive"
            >
              危险
            </Badge>
          {/if}
          {#if approved}
            <Badge
              variant="secondary"
              class="rounded-lg border-none bg-primary/10 text-xs text-primary"
            >
              自动放行
            </Badge>
          {/if}
        </div>
        <p class="text-xs text-muted-foreground">{tool.description}</p>
      </div>

      <div class="flex shrink-0 items-center pt-1">
        <Switch
          checked={approved}
          onCheckedChange={() => onToggle?.(tool.name)}
        />
      </div>
    </div>
  {/each}

  {#if tools.length === 0}
    <p
      class="rounded-xl border border-dashed border-border/50 py-6 text-center text-xs text-muted-foreground"
    >
      该服务暂无可用工具
    </p>
  {/if}
</div>
