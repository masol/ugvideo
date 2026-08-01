<!--
  Search Engine 配置对话框内容组件。
  通过 dialogStore.safeShow 调用。
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
  import type { DialogComponentProps } from "$lib/types/dialog";
  import {
    IconAlertCircle,
    IconCategory,
    IconLoader2,
    IconShield,
  } from "@tabler/icons-svelte";

  type Engine = {
    id: string;
    providerId: string;
    label: string;
    category: "general" | "news" | "academic" | "image" | "code";
    enabled: boolean;
    maxResults: number;
    safeSearch: "strict" | "moderate" | "off";
    recencyDays?: number;
    domains?: string[];
  };

  type Props = {
    engine?: Partial<Engine>;
    providerId: string;
    onSave?: (engine: Engine) => Promise<boolean>;
  } & DialogComponentProps<Engine>;

  let { engine, providerId, onSave, onClose, onCancel }: Props = $props();

  const isEditMode = !!engine?.id;

  let id = $state(engine?.id ?? "");
  let label = $state(engine?.label ?? "");
  let category = $state<Engine["category"]>(engine?.category ?? "general");
  let enabled = $state(engine?.enabled ?? true);
  let maxResults = $state(engine?.maxResults ?? 10);
  let safeSearch = $state<Engine["safeSearch"]>(
    engine?.safeSearch ?? "moderate",
  );
  let recencyDays = $state<number | undefined>(engine?.recencyDays);
  let domainsText = $state((engine?.domains ?? []).join("\n"));

  let isSubmitting = $state(false);
  let errorMessage = $state("");

  const isValid = $derived(id.trim().length > 0 && label.trim().length > 0);

  async function handleSubmit() {
    if (!isValid || isSubmitting) return;
    isSubmitting = true;
    errorMessage = "";
    try {
      const domains = domainsText
        .split(/\s+/)
        .map((s) => s.trim())
        .filter(Boolean);
      const result: Engine = {
        id: id.trim(),
        providerId,
        label: label.trim(),
        category,
        enabled,
        maxResults,
        safeSearch,
        recencyDays,
        domains: domains.length > 0 ? domains : undefined,
      };
      if (onSave && (await onSave(result))) return;
      onClose(result);
    } catch (e) {
      errorMessage = e instanceof Error ? e.message : "保存失败";
    } finally {
      isSubmitting = false;
    }
  }

  const CATEGORIES: Engine["category"][] = [
    "general",
    "news",
    "academic",
    "image",
    "code",
  ];
  const SAFESEARCH: Engine["safeSearch"][] = ["strict", "moderate", "off"];
</script>

<DialogHeader>
  <DialogTitle>{isEditMode ? "编辑引擎" : "新建引擎"}</DialogTitle>
  <DialogDescription>
    {isEditMode
      ? "修改搜索引擎的过滤与质量参数"
      : "在当前后端下新增一个搜索引擎能力"}
  </DialogDescription>
</DialogHeader>

<div class="space-y-4 py-4">
  <div class="grid grid-cols-1 gap-4 sm:grid-cols-2">
    <div class="space-y-2">
      <Label for="eng-id">引擎 ID</Label>
      <Input
        id="eng-id"
        bind:value={id}
        placeholder="general"
        class="rounded-xl font-mono"
      />
    </div>
    <div class="space-y-2">
      <Label for="eng-label">显示名称</Label>
      <Input
        id="eng-label"
        bind:value={label}
        placeholder="通用搜索"
        class="rounded-xl"
      />
    </div>
  </div>

  <div class="space-y-2">
    <Label class="flex items-center gap-2">
      <IconCategory size={14} stroke={1.5} class="text-muted-foreground" />
      类别
    </Label>
    <div class="flex flex-wrap gap-2">
      {#each CATEGORIES as cat (cat)}
        {@const active = category === cat}
        <button
          type="button"
          onclick={() => (category = cat)}
          class={[
            "rounded-xl border px-3 py-1.5 text-sm transition-all duration-200",
            active
              ? "border-primary/50 bg-primary/10 text-primary"
              : "border-border/50 bg-background text-muted-foreground hover:bg-muted",
          ]}
        >
          {cat}
        </button>
      {/each}
    </div>
  </div>

  <div class="grid grid-cols-1 gap-4 sm:grid-cols-2">
    <div class="space-y-2">
      <Label for="eng-max">最大结果数</Label>
      <Input
        id="eng-max"
        type="number"
        bind:value={maxResults}
        class="rounded-xl tabular-nums"
        min="1"
        max="50"
      />
    </div>
    <div class="space-y-2">
      <Label class="flex items-center gap-2">
        <IconShield size={14} stroke={1.5} class="text-muted-foreground" />
        安全搜索
      </Label>
      <div class="flex gap-1.5">
        {#each SAFESEARCH as ss (ss)}
          {@const active = safeSearch === ss}
          <button
            type="button"
            onclick={() => (safeSearch = ss)}
            class={[
              "flex-1 rounded-xl border px-2 py-1.5 text-xs transition-all duration-200",
              active
                ? "border-primary/50 bg-primary/10 text-primary"
                : "border-border/50 bg-background text-muted-foreground hover:bg-muted",
            ]}
          >
            {ss}
          </button>
        {/each}
      </div>
    </div>
  </div>

  <div class="space-y-2">
    <Label for="eng-recency">新鲜度（天，可选）</Label>
    <Input
      id="eng-recency"
      type="number"
      value={recencyDays ?? ""}
      oninput={(e) => {
        const raw = (e.currentTarget as HTMLInputElement).value;
        recencyDays = raw ? Number(raw) : undefined;
      }}
      placeholder="不限"
      class="rounded-xl tabular-nums"
    />
  </div>

  <div class="space-y-2">
    <Label for="eng-domains">域名白名单（每行一个 / 空格分隔）</Label>
    <Input
      id="eng-domains"
      bind:value={domainsText}
      placeholder="example.com docs.example.com"
      class="rounded-xl font-mono"
    />
  </div>

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
