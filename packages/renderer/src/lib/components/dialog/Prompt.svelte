<!--
  ╭─────────────────────────────────────────────────────╮
  │ [对话框内容组件 → PromptDialog.svelte]                │
  │ 职责：通用单行/多行字符串输入对话框（取代 prompt）      │
  │ 契约：onClose(string) 返回输入值 / onCancel() 取消    │
  │ 新增：validator 异步验证，错误提示，加载状态           │
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
  import { Input } from "$lib/components/ui/input";
  import { Label } from "$lib/components/ui/label";
  import { Textarea } from "$lib/components/ui/textarea";
  import type { DialogComponentProps } from "$lib/types/dialog";
  import { IconCheck, IconLoader2, IconX } from "@tabler/icons-svelte";

  type Props = {
    /** 对话框标题 */
    title?: string;
    /** 补充说明文字 */
    description?: string;
    /** 输入框上方的字段标签 */
    label?: string;
    /** 占位提示 */
    placeholder?: string;
    /** 初始值 */
    initialValue?: string;
    /** 确认按钮文字 */
    confirmText?: string;
    /** 取消按钮文字 */
    cancelText?: string;
    /** 是否使用多行文本域 */
    multiline?: boolean;
    /** 多行模式的行数 */
    rows?: number;
    /** 是否必填（为空时禁用确认） */
    required?: boolean;
    /** 最大字符数（0 表示不限制） */
    maxLength?: number;
    /** 自定义验证函数，返回非空字符串表示错误，空字符串 / false 表示通过 */
    validator?: (value: string) => string | false | Promise<string | false>;
  } & DialogComponentProps<string>;

  let {
    title = "请输入",
    description = "",
    label = "",
    placeholder = "请输入内容…",
    initialValue = "",
    confirmText = "确认",
    cancelText = "取消",
    multiline = false,
    rows = 6,
    required = false,
    maxLength = 0,
    validator,
    onClose,
    onCancel,
  }: Props = $props();

  // 输入值
  let value = $state(initialValue);

  // 计算衍生状态
  const trimmed = $derived(value.trim());
  const isValid = $derived(!required || trimmed.length > 0);
  const charCount = $derived(value.length);
  const overLimit = $derived(maxLength > 0 && charCount > maxLength);
  const canConfirm = $derived(isValid && !overLimit);

  // 验证相关状态
  let errorMsg = $state("");
  let validating = $state(false);
  let validationVersion = $state(0);
  let cancelled = $state(false);

  const inputId = "prompt-dialog-field";

  /** 处理输入变化：清除旧错误，取消旧的验证状态 */
  function handleInput() {
    validationVersion++;
    errorMsg = "";
    if (validating) validating = false;
  }

  /** 确认按钮逻辑（支持异步验证） */
  async function handleConfirm() {
    if (!canConfirm) return;
    const trimmedValue = trimmed;

    // 没有验证器，直接关闭
    if (!validator) {
      onClose(trimmedValue);
      return;
    }

    // 准备验证
    cancelled = false; // 重置取消标记
    const currentVersion = ++validationVersion;
    errorMsg = "";
    validating = true;

    try {
      const result = await validator(trimmedValue);

      // 如果用户取消或版本已变更，忽略结果
      if (cancelled || currentVersion !== validationVersion) return;

      // 检查结果：非空字符串表示错误
      if (result && typeof result === "string" && result.trim() !== "") {
        errorMsg = result;
        validating = false;
        return;
      }

      // 验证通过
      validating = false;
      onClose(trimmedValue);
    } catch (e) {
      if (cancelled || currentVersion !== validationVersion) return;
      errorMsg = e instanceof Error ? e.message : "验证出错";
      validating = false;
    }
  }

  /** 取消按钮：标记取消并调用外部回调 */
  function handleCancel() {
    cancelled = true;
    onCancel();
  }

  // 单行模式下按 Enter 直接确认
  function handleKeydown(e: KeyboardEvent) {
    if (!multiline && e.key === "Enter") {
      e.preventDefault();
      handleConfirm();
    }
  }
</script>

<DialogHeader>
  <DialogTitle>{title}</DialogTitle>
  {#if description}
    <DialogDescription>{description}</DialogDescription>
  {/if}
</DialogHeader>

<div class="space-y-2 py-4">
  {#if label}
    <Label for={inputId} class="text-sm font-medium">
      {label}
      {#if required}
        <span class="text-destructive">*</span>
      {/if}
    </Label>
  {/if}

  {#if multiline}
    <Textarea
      id={inputId}
      bind:value
      {placeholder}
      {rows}
      class="min-h-32 resize-y rounded-xl border-border/50 bg-background"
      oninput={handleInput}
    />
  {:else}
    <Input
      id={inputId}
      bind:value
      {placeholder}
      onkeydown={handleKeydown}
      oninput={handleInput}
      class="rounded-xl border-border/50 bg-background"
    />
  {/if}

  <!-- 错误提示 -->
  {#if errorMsg}
    <p class="text-sm text-destructive mt-1">{errorMsg}</p>
  {/if}

  <!-- 字符计数 -->
  {#if maxLength > 0}
    <div class="flex justify-end">
      <span
        class="text-xs"
        class:text-muted-foreground={!overLimit}
        class:text-destructive={overLimit}
      >
        {charCount} / {maxLength}
      </span>
    </div>
  {/if}
</div>

<DialogFooter class="mt-4">
  <Button variant="outline" class="rounded-xl" onclick={handleCancel}>
    <IconX class="size-4" />
    {cancelText}
  </Button>
  <Button
    class="rounded-xl"
    onclick={handleConfirm}
    disabled={!canConfirm || validating}
  >
    {#if validating}
      <IconLoader2 class="size-4 animate-spin" />
      验证中...
    {:else}
      <IconCheck class="size-4" />
      {confirmText}
    {/if}
  </Button>
</DialogFooter>
