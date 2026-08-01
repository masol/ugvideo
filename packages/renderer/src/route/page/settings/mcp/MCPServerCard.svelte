<script lang="ts">
  import { Badge } from "$lib/components/ui/badge";
  import { Button } from "$lib/components/ui/button";
  import * as Collapsible from "$lib/components/ui/collapsible";
  import { Separator } from "$lib/components/ui/separator";
  import { Switch } from "$lib/components/ui/switch";
  import {
    IconChevronDown,
    IconCloudOff,
    IconPencil,
    IconPlugConnected,
    IconTool,
    IconTrash,
  } from "@tabler/icons-svelte";
  import ToolPermissionEditor from "./ToolPermissionEditor.svelte";
  import type { MCPServerConfig } from "./types";

  let {
    server,
    open = false,
    onOpenChange,
    onEdit,
    onRemove,
    onToggleEnabled,
    onToggleAutoApprove,
  }: {
    server: MCPServerConfig;
    open?: boolean;
    onOpenChange?: (v: boolean) => void;
    onEdit?: () => void;
    onRemove?: () => void;
    onToggleEnabled?: (enabled: boolean) => void;
    onToggleAutoApprove?: (toolName: string) => void;
  } = $props();

  const isDisabled = $derived(!server.enabled);

  function handleToggle(checked: boolean) {
    server.enabled = checked;
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
            <IconPlugConnected
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
                {server.name}
              </span>
              <Badge variant="secondary" class="rounded-lg text-xs">
                {server.transport}
              </Badge>
              {#if isDisabled}
                <Badge
                  variant="secondary"
                  class="rounded-lg border-none bg-destructive/10 text-xs text-destructive"
                >
                  <IconCloudOff size={12} stroke={1.5} class="mr-1" />
                  已禁用
                </Badge>
              {/if}
            </div>
            <p class="mt-0.5 truncate text-xs text-muted-foreground">
              {server.id}
              {#if server.transport === "stdio" && server.command}
                <span class="ml-2 font-mono">
                  {server.command}
                  {(server.args ?? []).join(" ")}
                </span>
              {:else if server.url}
                <span class="ml-2">{server.url}</span>
              {/if}
            </p>
          </div>

          <div class="flex shrink-0 items-center gap-3">
            <Switch
              checked={!isDisabled}
              onCheckedChange={handleToggle}
              class="scale-90"
            />

            <Badge variant="outline" class="rounded-lg text-xs">
              <IconTool size={12} stroke={1.5} class="mr-1" />
              {server.tools.length} 个工具
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
              该 MCP 服务已被禁用，运行期不可用，配置仍然保留。
            </p>
          </div>
        {/if}

        <!-- 描述 + 编辑 -->
        <div class="flex flex-wrap items-center justify-between gap-4">
          <p class="max-w-2xl text-sm text-muted-foreground">
            {server.description ?? "（未提供描述）"}
          </p>
          <div class="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              class="gap-2 rounded-xl text-xs"
              onclick={() => onEdit?.()}
            >
              <IconPencil size={14} stroke={1.5} />
              编辑
            </Button>
          </div>
        </div>

        <Separator />

        <ToolPermissionEditor
          tools={server.tools}
          autoApprove={server.autoApprove}
          onToggle={onToggleAutoApprove}
        />

        <Separator />

        <div class="flex items-center justify-between">
          <p class="text-xs text-muted-foreground">
            移除后该服务及其工具权限将被永久删除
          </p>
          <Button
            variant="ghost"
            size="sm"
            class="gap-2 rounded-xl text-destructive hover:bg-destructive/10 hover:text-destructive"
            onclick={() => onRemove?.()}
          >
            <IconTrash size={14} stroke={1.5} />
            移除服务
          </Button>
        </div>
      </div>
    </Collapsible.Content>
  </div>
</Collapsible.Root>
