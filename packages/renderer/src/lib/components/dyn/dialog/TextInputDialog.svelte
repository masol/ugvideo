<!--
  ╭─────────────────────────────────────────────────────╮
  │ [通用文本输入对话框 → TextInputDialog.svelte]         │
  │ 职责：输入/编辑一段多行文本的极简对话框（业务中立）   │
  │ 契约：onClose(string) 返回文本 / onCancel() 取消      │
  │ 所有文案均可由 props 覆盖，默认值为通用中性词         │
  ╰─────────────────────────────────────────────────────╯
-->
<script lang="ts">
  import { Button } from "$lib/components/ui/button";
  import {
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
  } from "$lib/components/ui/dialog";
  import { Textarea } from "$lib/components/ui/textarea";
  import type { DialogComponentProps } from "$lib/types/dialog";
  import {
    IconAlertTriangle,
    IconDeviceFloppy,
    IconX,
  } from "@tabler/icons-svelte";
  import OptionSuggestCombobox from "./OptionSuggestCombobox.svelte";
  import type { TextInputDialogProps } from "./text-input-dialog.types";

  type Props = TextInputDialogProps & DialogComponentProps<string>;

  let {
    title = "编辑内容",
    description = "在下方输入文本内容。",
    placeholder = "在此输入…",
    initialText = "",
    alert = false,
    confirmLabel = "保存",
    cancelLabel = "取消",
    rows = 30,
    requireNonEmpty = true,
    options = [],
    onClose,
    onCancel,
  }: Props = $props();

  // svelte-ignore state_referenced_locally
  let text = $state(initialText);
  let textareaEl = $state<HTMLTextAreaElement | null>(null);
  // 弹层打开瞬间快照的光标位置；null 表示当时 textarea 未激活 → 应替换全部
  let lastSelection = $state<{ start: number; end: number } | null>(null);

  const isValid = $derived(!requireNonEmpty || text.trim().length > 0);
  const hasOptions = $derived(options.length > 0);

  function handleComboboxOpenChange(open: boolean) {
    if (!open) return;
    // 只在面板"即将打开"的那一刻快照光标
    if (textareaEl && document.activeElement === textareaEl) {
      lastSelection = {
        start: textareaEl.selectionStart ?? 0,
        end: textareaEl.selectionEnd ?? 0,
      };
    } else {
      lastSelection = null;
    }
  }

  function handleOptionSelect(value: string) {
    if (lastSelection === null) {
      // textarea 未激活 → 直接替换全部
      text = value;
    } else {
      const { start, end } = lastSelection;
      text = text.slice(0, start) + value + text.slice(end);
      const pos = start + value.length;
      // 让出一帧后聚焦并恢复光标
      setTimeout(() => {
        if (!textareaEl) return;
        textareaEl.focus();
        textareaEl.setSelectionRange(pos, pos);
      }, 0);
    }
    lastSelection = null;
  }

  function handleSave() {
    if (!isValid) return;
    onClose(text.trim());
  }
</script>

<DialogHeader>
  <DialogTitle>{title}</DialogTitle>
  {#if description}
    {#if alert}
      <div
        class="flex items-start gap-2.5 rounded-xl border border-destructive/50 bg-destructive/10 px-4 py-3"
      >
        <IconAlertTriangle
          size={18}
          stroke={1.5}
          class="mt-0.5 shrink-0 text-destructive"
        />
        <p class="text-sm font-medium leading-relaxed text-destructive">
          {description}
        </p>
      </div>
    {:else}
      <DialogDescription>{description}</DialogDescription>
    {/if}
  {/if}
</DialogHeader>

<div class="py-4">
  {#if hasOptions}
    <div class="mb-3 flex items-center justify-end">
      <OptionSuggestCombobox
        {options}
        onSelect={handleOptionSelect}
        onOpenChange={handleComboboxOpenChange}
      />
    </div>
  {/if}

  <Textarea
    bind:ref={textareaEl}
    bind:value={text}
    {placeholder}
    {rows}
    class="min-h-48 resize-y rounded-xl border-border/50 bg-background"
  />
</div>

<DialogFooter class="mt-4">
  <Button variant="outline" class="rounded-xl" onclick={() => onCancel()}>
    <IconX size={16} stroke={1.5} />
    {cancelLabel}
  </Button>
  <Button class="rounded-xl" onclick={handleSave} disabled={!isValid}>
    <IconDeviceFloppy size={16} stroke={1.5} />
    {confirmLabel}
  </Button>
</DialogFooter>
