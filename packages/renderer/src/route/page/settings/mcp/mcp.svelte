<script lang="ts">
  import { Separator } from "$lib/components/ui/separator";
  import { dialogStore } from "$lib/store/ui/dialog.svelte";
  import autoAnimate from "@formkit/auto-animate";
  import ConfigHeader from "./ConfigHeader.svelte";
  import EmptyState from "./EmptyState.svelte";
  import MCPServerCard from "./MCPServerCard.svelte";
  import MCPServerConfigDialog from "./MCPServerConfigDialog.svelte";
  import { mcpStore } from "./mcpstore.svelte";
  import SearchFilterBar from "./SearchFilterBar.svelte";
  import type { MCPServerConfig } from "./types";

  /* ═══ 派生统计 ═══ */
  let serverCount = $derived(mcpStore.servers.length);
  let enabledCount = $derived(mcpStore.servers.filter((s) => s.enabled).length);
  let toolCount = $derived(
    mcpStore.servers.reduce((s, x) => s + x.tools.length, 0),
  );
  let autoApproveCount = $derived(
    mcpStore.servers.reduce((s, x) => s + (x.autoApprove?.length ?? 0), 0),
  );

  let openStates = $state<Record<string, boolean>>({});
  let hasServers = $derived(mcpStore.servers.length > 0);

  /* ═══ Actions ═══
     以下回调均通过 store 完成；dialogStore 仅作为触发器，
     真正的数据落地走 mcpStore。
     TODO: store bridge —— 把 mcpStore.upsertServer / removeServer 替换为真实 configStore 同步。 */

  async function openAdd() {
    await dialogStore.safeShow(MCPServerConfigDialog, {
      onSave: async (server: MCPServerConfig) => {
        mcpStore.upsertServer(server);
        return false;
      },
    });
  }

  async function openEdit(serverId: string) {
    const server = mcpStore.servers.find((s) => s.id === serverId);
    if (!server) return;
    await dialogStore.safeShow(MCPServerConfigDialog, {
      server,
      onSave: async (next: MCPServerConfig) => {
        mcpStore.upsertServer(next);
        return false;
      },
    });
  }
</script>

<div class="flex h-full w-full flex-col overflow-y-auto bg-background">
  <div class="space-y-8 p-8 lg:p-12">
    <ConfigHeader
      {serverCount}
      {enabledCount}
      {toolCount}
      {autoApproveCount}
      onAddServer={openAdd}
    />

    {#if hasServers}
      <SearchFilterBar filteredServerCount={mcpStore.filteredServers.length} />
      <Separator />
    {/if}

    <div class="space-y-6" use:autoAnimate>
      {#each mcpStore.filteredServers as server (server.id)}
        <MCPServerCard
          {server}
          open={openStates[server.id] ?? false}
          onOpenChange={(v) => (openStates[server.id] = v)}
          onEdit={() => openEdit(server.id)}
          onRemove={() => mcpStore.removeServer(server.id)}
          onToggleEnabled={(enabled) => {
            // TODO: store bridge —— 持久化
            void enabled;
          }}
          onToggleAutoApprove={(toolName) => {
            mcpStore.toggleAutoApprove(server.id, toolName);
          }}
        />
      {/each}

      {#if mcpStore.isFiltering && mcpStore.filteredServers.length === 0}
        <EmptyState
          variant="filtered"
          onAction={() => mcpStore.clearAllFilters()}
        />
      {/if}

      {#if !mcpStore.isFiltering && !hasServers}
        <EmptyState variant="empty" onAction={openAdd} />
      {/if}
    </div>
  </div>
</div>
