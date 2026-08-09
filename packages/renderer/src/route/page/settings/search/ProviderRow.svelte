<script lang="ts">
  import { Badge } from "$lib/components/ui/badge";
  import { Button } from "$lib/components/ui/button";
  import { Input } from "$lib/components/ui/input";
  import { Switch } from "$lib/components/ui/switch";
  import { SERP_PROVIDERS } from "./types";
  import {
    IconExternalLink,
    IconEye,
    IconEyeOff,
    IconTrash,
  } from "@tabler/icons-svelte";
  import type { SearchProviderConfig } from "./types";

  let {
    provider,
    onUpdate,
    onRemove,
  }: {
    provider: SearchProviderConfig;
    onUpdate?: (updates: Partial<SearchProviderConfig>) => void;
    onRemove?: () => void;
  } = $props();

  const meta = $derived(SERP_PROVIDERS.find((m) => m.type === provider.type)!);

  let keyVisible = $state(false);

  function handleKeyInput(e: Event) {
    const v = (e.currentTarget as HTMLInputElement).value;
    onUpdate?.({ apiKey: v });
  }
</script>

<div
  class={[
    "rounded-2xl border border-border/50 bg-card p-6 shadow-sm transition-all duration-200",
    !provider.enabled && "bg-card/60 opacity-70",
  ]}
>
  <div class="flex flex-wrap items-center gap-4">
    <div
      class={[
        "flex size-10 shrink-0 items-center justify-center rounded-xl transition-all duration-200",
        provider.enabled ? "bg-primary/10" : "bg-muted",
      ]}
    >
      <span
        class={[
          "text-sm font-semibold",
          provider.enabled ? "text-primary" : "text-muted-foreground/50",
        ]}
      >
        {provider.name.charAt(0)}
      </span>
    </div>

    <div class="min-w-0 flex-1">
      <div class="flex flex-wrap items-center gap-2">
        <span
          class={[
            "text-base font-medium transition-all duration-200",
            !provider.enabled &&
              "line-through decoration-muted-foreground/40 decoration-1",
          ]}
        >
          {provider.name}
        </span>
        <Badge variant="outline" class="rounded-lg font-mono text-xs">
          {provider.type}
        </Badge>
        {#if !provider.enabled}
          <Badge
            variant="secondary"
            class="rounded-lg border-none bg-muted text-xs text-muted-foreground"
          >
            已禁用
          </Badge>
        {/if}
      </div>
    </div>

    <div class="flex shrink-0 items-center gap-2">
      <Switch
        checked={provider.enabled}
        onCheckedChange={(checked) => onUpdate?.({ enabled: checked })}
      />
      <Button
        variant="ghost"
        size="icon"
        class="size-8 rounded-lg text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
        onclick={() => onRemove?.()}
      >
        <IconTrash size={16} stroke={1.5} />
      </Button>
    </div>
  </div>

  <div class="mt-4 space-y-2">
    <div class="flex items-center justify-between">
      <label
        for="key-{provider.id}"
        class="text-xs font-medium text-muted-foreground"
      >
        API 密钥
      </label>
      <a
        href={meta.docUrl}
        target="_blank"
        rel="noopener noreferrer"
        class="flex items-center gap-1 text-xs text-primary transition-all duration-200 hover:text-primary/80"
      >
        申请密钥
        <IconExternalLink size={12} stroke={1.5} />
      </a>
    </div>
    <div class="relative">
      <Input
        id="key-{provider.id}"
        type={keyVisible ? "text" : "password"}
        value={provider.apiKey}
        oninput={handleKeyInput}
        placeholder="sk-..."
        class="rounded-xl pr-9 font-mono"
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
