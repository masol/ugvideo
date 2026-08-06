<!-- ConnectionSection.svelte -->
<script lang="ts">
  import { Input } from "$lib/components/ui/input";
  import { Label } from "$lib/components/ui/label";
  import ProtocolCombobox from "./ProtocolCombobox.svelte";

  import { type ProviderProtocol } from "$lib/utils/model/types";
  import { IconRouter, IconServer, IconWorld } from "@tabler/icons-svelte";

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
      <ProtocolCombobox bind:protocol />
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
