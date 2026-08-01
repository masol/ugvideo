<!-- ConnectionSection.svelte -->
<script lang="ts">
  import * as DropdownMenu from "$lib/components/ui/dropdown-menu";
  import { Input } from "$lib/components/ui/input";
  import { Label } from "$lib/components/ui/label";
  import {
    allProtocols,
    protocolLabels,
    type ProviderProtocol,
  } from "$lib/utils/model/types";
  import {
    IconCheck,
    IconChevronDown,
    IconRouter,
    IconServer,
    IconWorld,
  } from "@tabler/icons-svelte";

  let {
    protocol = $bindable<ProviderProtocol | undefined>(),
    baseUrl = $bindable(""),
    maxConn = $bindable<number | undefined>(),
    proxyUrl = $bindable(""),
  }: {
    protocol?: ProviderProtocol;
    baseUrl?: string;
    maxConn?: number;
    proxyUrl?: string;
  } = $props();
</script>

<div class="space-y-4 rounded-2xl border border-border/50 p-6">
  <h3 class="flex items-center gap-2 text-base font-medium">
    <IconServer class="size-4 text-muted-foreground" />
    连接配置
  </h3>

  <div class="space-y-2">
    <Label for="dlg-base-url" class="flex items-center gap-2">
      <IconWorld class="size-4 text-muted-foreground" />
      服务端点
    </Label>
    <Input
      id="dlg-base-url"
      bind:value={baseUrl}
      placeholder="https://api.example.com/v1"
      class="rounded-xl"
    />
  </div>

  <div class="grid grid-cols-1 gap-4 sm:grid-cols-2">
    <div class="space-y-2">
      <Label>接口协议</Label>
      <DropdownMenu.Root>
        <DropdownMenu.Trigger>
          {#snippet child({ props })}
            <button
              {...props}
              type="button"
              class="flex h-9 w-full items-center justify-between rounded-xl border border-input bg-background px-3 text-sm transition-all duration-200 hover:bg-muted/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <span
                class={protocol ? "text-foreground" : "text-muted-foreground"}
              >
                {protocol ? protocolLabels[protocol] : "选择协议"}
              </span>
              <IconChevronDown class="size-4 shrink-0 text-muted-foreground" />
            </button>
          {/snippet}
        </DropdownMenu.Trigger>
        <DropdownMenu.Content
          class="w-48 rounded-xl"
          align="start"
          style="z-index: 9999;"
        >
          {#each Object.values(allProtocols) as proto (proto)}
            <DropdownMenu.Item
              class="flex items-center justify-between rounded-lg"
              onclick={() => (protocol = proto)}
            >
              <span>{protocolLabels[proto]}</span>
              {#if protocol === proto}<IconCheck
                  class="size-4 text-primary"
                />{/if}
            </DropdownMenu.Item>
          {/each}
        </DropdownMenu.Content>
      </DropdownMenu.Root>
    </div>

    <div class="space-y-2">
      <Label for="dlg-maxconn">最大并发</Label>
      <Input
        id="dlg-maxconn"
        type="number"
        value={maxConn != null ? String(maxConn) : ""}
        oninput={(e: Event) => {
          const raw = (e.currentTarget as HTMLInputElement).value;
          const num = raw ? parseInt(raw) : undefined;
          maxConn = num != null && !Number.isNaN(num) ? num : undefined;
        }}
        placeholder="不限制"
        class="rounded-xl"
        min="1"
      />
    </div>
  </div>

  <div
    class={[
      "flex items-center gap-2 transition-all duration-200",
      !proxyUrl ? "opacity-30 hover:opacity-75" : "opacity-100",
    ]}
  >
    <IconRouter class="size-5 shrink-0 text-muted-foreground" stroke={1.5} />
    <Input
      bind:value={proxyUrl}
      id="dlg-proxy-url"
      placeholder="代理地址（可选）"
      class="min-w-0 flex-1 rounded-xl border-dashed"
    />
  </div>
</div>
