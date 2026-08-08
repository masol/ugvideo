<!-- src/lib/components/dyn/nodes/FieldNode.svelte -->
<script lang="ts">
  import { Button } from "$lib/components/ui/button";
  import { Input } from "$lib/components/ui/input";
  import type { IValueService } from "$lib/store/ui/activity/type";
  import { dialogStore } from "$lib/store/ui/dialog.svelte";
  import { IconLoader2, IconPencil } from "@tabler/icons-svelte";
  import type { FieldNode } from "../ast";
  import { coerceString, useBinding } from "../binding.svelte";
  import TextInputDialog from "../dialog/TextInputDialog.svelte";

  let { node, service }: { node: FieldNode; service: IValueService } = $props();

  const b = useBinding<string>(service, () => node.binding);
  let value = $derived(coerceString(b.value));
  let loading = $derived(b.loading);
  let readonly = $derived(b.readonly);

  let isEditing = $state(false);
  let tempValue = $state("");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let inputRef: any = null;

  function startInline() {
    if (loading || readonly) return;
    tempValue = value;
    isEditing = true;
    setTimeout(() => {
      inputRef?.focus?.();
      inputRef?.select?.();
    }, 0);
  }

  async function saveInline() {
    if (loading) return;
    const trimmed = tempValue.trim();
    if (trimmed && trimmed !== value) await b.set(trimmed);
    isEditing = false;
  }

  function cancelInline() {
    isEditing = false;
  }

  function inlineKeydown(e: KeyboardEvent) {
    if (e.key === "Enter") {
      e.preventDefault();
      saveInline();
    } else if (e.key === "Escape") {
      e.preventDefault();
      cancelInline();
    }
  }

  async function editDialog() {
    if (loading || readonly) return;
    const content = await dialogStore.safeShow(
      TextInputDialog,
      {
        title: node.dialogTitle ?? `编辑${node.label}`,
        description: node.dialogDescription,
        placeholder: node.placeholder,
        initialText: value,
        alert: node.alert,
      },
      { size: "xl" },
    );
    if (content === null) return;
    await b.set(content);
  }
</script>

{#if node.editor === "inline"}
  <div
    class="group relative rounded-xl border border-border/50 bg-card px-4 py-3 shadow-sm transition-all duration-200 hover:shadow-md"
  >
    {#if isEditing}
      <div class="flex items-center gap-2">
        <Input
          id={`field-${node.binding.key}`}
          bind:this={inputRef}
          bind:value={tempValue}
          class="rounded-lg flex-1 h-8 text-sm"
          placeholder={node.placeholder}
          onblur={saveInline}
          onkeydown={inlineKeydown}
          disabled={loading}
        />
        <Button
          size="sm"
          variant="ghost"
          class="h-7 rounded-lg px-2 text-xs"
          onclick={cancelInline}
          disabled={loading}
        >
          取消
        </Button>
      </div>
    {:else}
      <div class="flex items-center justify-between gap-3">
        <div class="flex-1 min-w-0">
          <label
            for={`field-${node.binding.key}`}
            class="block text-xs text-muted-foreground mb-1"
          >
            {node.label}
            {#if loading}
              <IconLoader2
                size={12}
                stroke={1.5}
                class="ml-1 inline animate-spin text-muted-foreground"
              />
            {/if}
          </label>
          <button
            class="text-sm font-medium text-foreground hover:text-primary transition-colors duration-200 text-left truncate w-full"
            onclick={startInline}
            disabled={readonly}
          >
            {value || node.emptyHint || "未设置"}
          </button>
          {#if b.error}
            <p class="mt-1 text-xs text-destructive">{b.error}</p>
          {/if}
        </div>
        {#if !readonly}
          <Button
            size="icon"
            variant="ghost"
            class="h-7 w-7 rounded-lg shrink-0 opacity-0 transition-opacity duration-200 group-hover:opacity-100"
            onclick={startInline}
            disabled={loading}
            aria-label={`编辑${node.label}`}
          >
            <IconPencil size={14} stroke={1.5} />
          </Button>
        {/if}
      </div>
    {/if}
  </div>
{:else}
  <button
    class="group w-full text-left rounded-xl border border-border/50 bg-card px-4 py-3 shadow-sm transition-all duration-200 hover:shadow-md hover:border-border"
    onclick={editDialog}
    disabled={loading || readonly}
  >
    <div class="flex items-start justify-between gap-3">
      <div class="flex-1 min-w-0">
        <div class="text-xs text-muted-foreground mb-1.5">
          {node.label}
          {#if loading}
            <IconLoader2
              size={12}
              stroke={1.5}
              class="ml-1 inline animate-spin text-muted-foreground"
            />
          {/if}
        </div>
        {#if value}
          <p class="text-sm text-foreground/80 leading-relaxed line-clamp-2">
            {value}
          </p>
        {:else}
          <p class="text-sm text-muted-foreground/60 italic">
            {node.emptyHint || `点击添加${node.label}`}
          </p>
        {/if}
      </div>
      {#if !readonly}
        <IconPencil
          size={14}
          stroke={1.5}
          class="shrink-0 mt-0.5 text-muted-foreground opacity-0 transition-opacity duration-200 group-hover:opacity-100"
        />
      {/if}
    </div>
  </button>
{/if}
