<script lang="ts">
  import ChatMessage from "$lib/components/markdown/Message.svelte";
  import type { Message } from "$lib/components/markdown/type";
  import * as AlertDialog from "$lib/components/ui/alert-dialog/index.js";
  import { confirmStore } from "$lib/store/ui/confirm.svelte";
  import {
    DIALOG_SIZE_CLASSES,
    type DialogSize,
  } from "$lib/store/ui/dialog.svelte";
  import { cn } from "$lib/utils/index";
  import {
    IconAlertCircle,
    IconAlertTriangle,
    IconCircleCheck,
    IconHelp,
    IconInfoCircle,
  } from "@tabler/icons-svelte";
  import { RuntimeIcon } from "./runtimeicon";

  const message: Message = $derived.by(() => {
    return {
      role: "assistant",
      id: crypto.randomUUID(),
      content: confirmStore.message,
      isError: confirmStore.variant === "error",
      timestamp: new Date(),
    };
  });
</script>

<!-- ════════════════════════════════════════════════════════════
     Confirm AlertDialog — 全局唯一，由 confirmStore 驱动
     ════════════════════════════════════════════════════════════ -->
<AlertDialog.Root
  open={confirmStore.open}
  onOpenChange={(v) => confirmStore.handleOpenChange(v)}
>
  <AlertDialog.Content
    class={cn(
      "z-100 gap-0 overflow-hidden p-0 transition-all duration-200",
      DIALOG_SIZE_CLASSES[confirmStore.size as DialogSize] ||
        DIALOG_SIZE_CLASSES.md,
    )}
  >
    <!-- 顶部装饰条 -->
    <div
      class={[
        "h-1.5 w-full transition-colors duration-200",
        confirmStore.destructive && "bg-destructive",
        !confirmStore.destructive &&
          confirmStore.variant === "warning" &&
          "bg-amber-500",
        !confirmStore.destructive &&
          confirmStore.variant === "error" &&
          "bg-destructive",
        !confirmStore.destructive &&
          confirmStore.variant === "info" &&
          "bg-blue-500",
        !confirmStore.destructive &&
          confirmStore.variant === "success" &&
          "bg-emerald-500",
        !confirmStore.destructive &&
          confirmStore.variant === "question" &&
          "bg-primary",
        !confirmStore.destructive && !confirmStore.variant && "bg-primary",
      ]}
    ></div>

    <div class="flex gap-4 p-6 pb-4">
      <!-- 图标区域 -->
      <div
        class={[
          "flex size-12 shrink-0 items-center justify-center rounded-2xl transition-all duration-200",
          confirmStore.destructive &&
            "bg-destructive/15text-destructive animate-pulse",
          !confirmStore.destructive &&
            confirmStore.variant === "warning" &&
            "bg-amber-500/10 text-amber-600 dark:text-amber-500",
          !confirmStore.destructive &&
            confirmStore.variant === "error" &&
            "bg-destructive/10 text-destructive",
          !confirmStore.destructive &&
            confirmStore.variant === "info" &&
            "bg-blue-500/10 text-blue-600 dark:text-blue-500",
          !confirmStore.destructive &&
            confirmStore.variant === "success" &&
            "bg-emerald-500/10 text-emerald-600 dark:text-emerald-500",
          !confirmStore.destructive &&
            (confirmStore.variant === "question" || !confirmStore.variant) &&
            "bg-primary/10 text-primary",
        ]}
      >
        {#if confirmStore.destructive}
          {#if confirmStore.icon}
            <RuntimeIcon name={confirmStore.icon} size={24} stroke={2.5}
            ></RuntimeIcon>
          {:else}
            <IconAlertCircle size={24} stroke={2.5} />
          {/if}
        {:else if confirmStore.variant === "warning" || confirmStore.variant === "error"}
          {#if confirmStore.icon}
            <RuntimeIcon name={confirmStore.icon} size={24} stroke={2}
            ></RuntimeIcon>
          {:else}
            <IconAlertTriangle size={24} stroke={2} />
          {/if}
        {:else if confirmStore.variant === "info"}
          {#if confirmStore.icon}
            <RuntimeIcon name={confirmStore.icon} size={24} stroke={2}
            ></RuntimeIcon>
          {:else}
            <IconInfoCircle size={24} stroke={2} />
          {/if}
        {:else if confirmStore.variant === "success"}
          {#if confirmStore.icon}
            <RuntimeIcon name={confirmStore.icon} size={24} stroke={2}
            ></RuntimeIcon>
          {:else}
            <IconCircleCheck size={24} stroke={2} />
          {/if}
        {:else if confirmStore.icon}
          <RuntimeIcon name={confirmStore.icon} size={24} stroke={2}
          ></RuntimeIcon>
        {:else}
          <IconHelp size={24} stroke={2} />
        {/if}
      </div>

      <!-- 文本内容区域 -->
      <div class="flex-1 space-y-2 pt-0.5">
        <AlertDialog.Header class="space-y-2 p-0 text-left">
          <AlertDialog.Title
            class={[
              "text-lg font-semibold leading-tight tracking-tight",
              confirmStore.destructive && "text-destructive",
            ]}
          >
            {confirmStore.title}
          </AlertDialog.Title>
          {#if confirmStore.message}
            <AlertDialog.Description
              class="text-sm leading-relaxed text-muted-foreground"
            >
              {#if confirmStore.markdown}
                <ChatMessage {message} />
              {:else}
                {confirmStore.message}
              {/if}
            </AlertDialog.Description>
          {/if}
        </AlertDialog.Header>
      </div>
    </div>

    <!-- 底部按钮区域 -->
    <AlertDialog.Footer
      class={[
        "flex-row justify-end gap-3 border-t px-6 py-4",
        confirmStore.destructive
          ? "border-destructive/20 bg-destructive/5"
          : "border-border/50 bg-muted/30",
      ]}
    >
      {#if !confirmStore.hideCancel}
        <AlertDialog.Cancel
          class="rounded-xl px-4 transition-all duration-200 hover:-translate-y-0.5 hover:shadow-sm"
          onclick={() => confirmStore.cancel()}
        >
          {confirmStore.cancelLabel || "取消"}
        </AlertDialog.Cancel>
      {/if}
      <AlertDialog.Action
        class={[
          "rounded-xl px-4 shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:shadow-md",
          confirmStore.destructive &&
            "bg-destructive text-destructive-foreground hover:bg-destructive/90 ring-2 ring-destructive/20",
          !confirmStore.destructive &&
            confirmStore.variant === "warning" &&
            "bg-amber-500 text-white hover:bg-amber-600",
          !confirmStore.destructive &&
            confirmStore.variant === "error" &&
            "bg-destructive text-destructive-foreground hover:bg-destructive/90",
          !confirmStore.destructive &&
            confirmStore.variant === "info" &&
            "bg-blue-500 text-white hover:bg-blue-600",
          !confirmStore.destructive &&
            confirmStore.variant === "success" &&
            "bg-emerald-500 text-white hover:bg-emerald-600",
          !confirmStore.destructive &&
            (confirmStore.variant === "question" || !confirmStore.variant) &&
            "bg-primary text-primary-foreground hover:bg-primary/90",
        ]}
        onclick={() => confirmStore.confirm()}
      >
        {confirmStore.confirmLabel || "确认"}
      </AlertDialog.Action>
    </AlertDialog.Footer>
  </AlertDialog.Content>
</AlertDialog.Root>
