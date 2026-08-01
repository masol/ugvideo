<!--
  MCP 服务配置对话框内容组件。

  使用方式（命令式）：
    await dialogStore.safeShow(MCPServerConfigDialog, {
      server,
      onSave: (cfg) => mcpStore.upsertServer(cfg),
    });
-->
<script lang="ts">
  import * as Alert from "$lib/components/ui/alert";
  import { Button } from "$lib/components/ui/button";
  import {
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
  } from "$lib/components/ui/dialog";
  import { Input } from "$lib/components/ui/input";
  import { Label } from "$lib/components/ui/label";
  import { Separator } from "$lib/components/ui/separator";
  import * as Tabs from "$lib/components/ui/tabs";
  import type { DialogComponentProps } from "$lib/types/dialog";
  import {
    IconAlertCircle,
    IconCirclePlus,
    IconLoader2,
    IconPlugConnected,
    IconSettings,
    IconTool,
    IconTrash,
  } from "@tabler/icons-svelte";
  import ToolPermissionEditor from "./ToolPermissionEditor.svelte";

  type Server = {
    id: string;
    name: string;
    transport: "stdio" | "sse" | "http";
    command?: string;
    args?: string[];
    url?: string;
    enabled: boolean;
    tools: Array<{ name: string; description: string; dangerous: boolean }>;
    autoApprove?: string[];
    timeoutMs?: number;
    description?: string;
  };

  type Props = {
    server?: Partial<Server>;
    onSave?: (server: Server) => Promise<boolean>;
  } & DialogComponentProps<Server>;

  let { server, onSave, onClose, onCancel }: Props = $props();

  const isEditMode = !!server?.id;

  // ── 表单状态 ──
  let id = $state(server?.id ?? "");
  let name = $state(server?.name ?? "");
  let transport = $state<Server["transport"]>(server?.transport ?? "stdio");
  let command = $state(server?.command ?? "");
  let argsText = $state((server?.args ?? []).join(" "));
  let url = $state(server?.url ?? "");
  let timeoutMs = $state<number | undefined>(server?.timeoutMs ?? 30000);
  let description = $state(server?.description ?? "");
  let tools = $state(server?.tools ?? []);
  let autoApprove = $state<string[]>(server?.autoApprove ?? []);

  function handleTransportChange(t: string) {
    if (t === "stdio" || t === "sse" || t === "http") {
      transport = t;
    }
  }

  // ── UI 状态 ──
  let isSubmitting = $state(false);
  let errorMessage = $state("");

  // ── 校验 ──
  const isValid = $derived(
    id.trim().length > 0 &&
      name.trim().length > 0 &&
      (transport === "stdio"
        ? command.trim().length > 0
        : url.trim().length > 0),
  );

  function parseArgs(): string[] {
    return argsText
      .split(/\s+/)
      .map((s) => s.trim())
      .filter(Boolean);
  }

  function handleAddTool() {
    tools = [...tools, { name: "new_tool", description: "", dangerous: false }];
  }
  function handleRemoveTool(idx: number) {
    tools = tools.filter((_, i) => i !== idx);
  }

  async function handleSubmit() {
    if (!isValid || isSubmitting) return;
    isSubmitting = true;
    errorMessage = "";
    try {
      const result: Server = {
        id: id.trim(),
        name: name.trim(),
        transport,
        command: transport === "stdio" ? command.trim() : undefined,
        args: transport === "stdio" ? parseArgs() : undefined,
        url: transport !== "stdio" ? url.trim() : undefined,
        enabled: server?.enabled ?? true,
        tools,
        autoApprove,
        timeoutMs,
        description: description.trim() || undefined,
      };
      if (onSave) {
        if (await onSave(result)) return;
      }
      onClose(result);
    } catch (e) {
      errorMessage = e instanceof Error ? e.message : "保存失败";
    } finally {
      isSubmitting = false;
    }
  }

  function handleToggleAutoApprove(toolName: string) {
    const idx = autoApprove.indexOf(toolName);
    if (idx >= 0) autoApprove.splice(idx, 1);
    else autoApprove.push(toolName);
  }
</script>

<DialogHeader>
  <DialogTitle>{isEditMode ? "编辑 MCP 服务" : "新建 MCP 服务"}</DialogTitle>
  <DialogDescription>
    {isEditMode ? "修改 MCP 服务连接与工具权限" : "接入一个新的 MCP 服务"}
  </DialogDescription>
</DialogHeader>

<div class="space-y-6 py-4">
  <Tabs.Root value="basic" class="w-full">
    <Tabs.List class="rounded-xl">
      <Tabs.Trigger value="basic" class="gap-1.5 rounded-xl">
        <IconSettings size={14} stroke={1.5} />
        基本信息
      </Tabs.Trigger>
      <Tabs.Trigger value="tools" class="gap-1.5 rounded-xl">
        <IconTool size={14} stroke={1.5} />
        工具权限
        <span
          class="ml-1 rounded-full bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground"
        >
          {tools.length}
        </span>
      </Tabs.Trigger>
    </Tabs.List>

    <Tabs.Content value="basic" class="space-y-4 pt-4">
      <div class="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div class="space-y-2">
          <Label for="mcp-id">服务 ID</Label>
          <Input
            id="mcp-id"
            bind:value={id}
            placeholder="github-mcp"
            class="rounded-xl font-mono"
          />
        </div>
        <div class="space-y-2">
          <Label for="mcp-name">显示名称</Label>
          <Input
            id="mcp-name"
            bind:value={name}
            placeholder="GitHub"
            class="rounded-xl"
          />
        </div>
      </div>

      <div class="space-y-2">
        <Label>传输协议</Label>
        <div class="flex flex-wrap gap-2">
          {#each ["stdio", "sse", "http"] as t (t)}
            {@const active = transport === t}
            <button
              type="button"
              onclick={() => handleTransportChange(t)}
              class={[
                "rounded-xl border px-3 py-1.5 text-sm transition-all duration-200",
                active
                  ? "border-primary/50 bg-primary/10 text-primary"
                  : "border-border/50 bg-background text-muted-foreground hover:bg-muted",
              ]}
            >
              {t}
            </button>
          {/each}
        </div>
      </div>

      {#if transport === "stdio"}
        <div class="space-y-2">
          <Label for="mcp-cmd">启动命令</Label>
          <Input
            id="mcp-cmd"
            bind:value={command}
            placeholder="npx"
            class="rounded-xl font-mono"
          />
        </div>
        <div class="space-y-2">
          <Label for="mcp-args">参数（空格分隔）</Label>
          <Input
            id="mcp-args"
            bind:value={argsText}
            placeholder="-y @modelcontextprotocol/server-github"
            class="rounded-xl font-mono"
          />
        </div>
      {:else}
        <div class="space-y-2">
          <Label for="mcp-url">端点 URL</Label>
          <Input
            id="mcp-url"
            bind:value={url}
            placeholder="https://mcp.example.com/xxx"
            class="rounded-xl"
          />
        </div>
      {/if}

      <div class="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div class="space-y-2">
          <Label for="mcp-timeout">超时（毫秒）</Label>
          <Input
            id="mcp-timeout"
            type="number"
            value={timeoutMs ?? ""}
            oninput={(e) => {
              const raw = (e.currentTarget as HTMLInputElement).value;
              timeoutMs = raw ? Number(raw) : undefined;
            }}
            class="rounded-xl tabular-nums"
          />
        </div>
        <div class="space-y-2">
          <Label for="mcp-desc">描述</Label>
          <Input
            id="mcp-desc"
            bind:value={description}
            placeholder="简要说明该服务的用途"
            class="rounded-xl"
          />
        </div>
      </div>
    </Tabs.Content>

    <Tabs.Content value="tools" class="space-y-4 pt-4">
      <div class="flex items-center justify-between">
        <h3 class="text-sm font-medium">声明的工具</h3>
        <Button
          variant="outline"
          size="sm"
          class="gap-1.5 rounded-xl"
          onclick={handleAddTool}
        >
          <IconCirclePlus size={14} stroke={1.5} />
          添加工具
        </Button>
      </div>

      {#if tools.length === 0}
        <div
          class="flex flex-col items-center justify-center space-y-2 rounded-xl border border-dashed border-border/50 py-10"
        >
          <IconPlugConnected
            size={20}
            stroke={1.5}
            class="text-muted-foreground"
          />
          <p class="text-sm text-muted-foreground">尚未声明工具</p>
        </div>
      {:else}
        <div class="space-y-3">
          {#each tools as tool, idx (tool.name + idx)}
            <div
              class="space-y-2 rounded-xl border border-border/50 bg-background p-3"
            >
              <div class="flex items-center gap-2">
                <Input
                  bind:value={tool.name}
                  class="min-w-0 flex-1 rounded-lg font-mono text-xs"
                  placeholder="tool_name"
                />
                <button
                  type="button"
                  class="flex size-8 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-all duration-200 hover:bg-destructive/10 hover:text-destructive"
                  onclick={() => handleRemoveTool(idx)}
                >
                  <IconTrash size={14} stroke={1.5} />
                </button>
              </div>
              <Input
                bind:value={tool.description}
                class="rounded-lg text-xs"
                placeholder="工具说明"
              />
              <label
                class="flex items-center gap-2 text-xs text-muted-foreground"
              >
                <input
                  type="checkbox"
                  bind:checked={tool.dangerous}
                  class="size-3.5 rounded border-border"
                />
                标记为危险操作（默认需要运行时确认）
              </label>
            </div>
          {/each}
        </div>
      {/if}

      <Separator />

      <ToolPermissionEditor
        {tools}
        {autoApprove}
        onToggle={handleToggleAutoApprove}
      />
    </Tabs.Content>
  </Tabs.Root>

  {#if errorMessage}
    <Alert.Root variant="destructive" class="rounded-xl">
      <IconAlertCircle class="size-4" />
      <Alert.Title>保存失败</Alert.Title>
      <Alert.Description>{errorMessage}</Alert.Description>
    </Alert.Root>
  {/if}
</div>

<DialogFooter class="mt-4">
  <Button variant="outline" onclick={() => onCancel()} disabled={isSubmitting}>
    取消
  </Button>
  <Button onclick={handleSubmit} disabled={!isValid || isSubmitting}>
    {#if isSubmitting}
      <IconLoader2 class="size-4 animate-spin" />
      保存中
    {:else}
      {isEditMode ? "保存更改" : "创建"}
    {/if}
  </Button>
</DialogFooter>
