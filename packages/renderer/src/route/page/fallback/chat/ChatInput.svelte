<script lang="ts">
  import { Button } from "$lib/components/ui/button";
  import { messageStore } from "$lib/store/local/msg.svelte";
  import {
    IconArrowsMaximize,
    IconArrowsMinimize,
    IconLoader2,
    IconMicrophone,
    IconPaperclip,
    IconPlayerStopFilled,
    IconSend,
    IconSlash,
    IconTrash,
  } from "@tabler/icons-svelte";
  import { tick } from "svelte";
  import ChatCommandMenu from "./ChatCommandMenu.svelte";
  import { chatCommands, filterCommands, type ChatCommand } from "./commands";

  let {
    value = $bindable(""),
    placeholder = "Enter 换行，Ctrl+Enter 发送",
    commands = chatCommands,
    canClear = false,
    onSend = () => {},
    onCommand = () => {},
    onAttach = () => {},
    onRecord = () => {},
    onClear = () => {},
  }: {
    value?: string;
    placeholder?: string;
    commands?: ChatCommand[];
    canClear?: boolean;
    onSend?: () => void;
    onCommand?: (cmd: ChatCommand) => void;
    onAttach?: () => void;
    onRecord?: () => void;
    onClear?: () => void;
  } = $props();

  let textarea = $state<HTMLTextAreaElement>();
  let showCommands = $state(false);
  let selectedIndex = $state(0);
  let isComposing = $state(false);

  let filtered = $derived(showCommands ? filterCommands(value, commands) : []);
  let sending = $derived(messageStore.isLoading);
  let aborting = $derived(messageStore.isAborting);
  let canSend = $derived(value.trim().length > 0 && !sending);

  // ✅ 修复：与 store 中的判断逻辑保持一致
  let allCollapsed = $derived.by(() => {
    const msgs = messageStore.messages;
    if (msgs.length === 0) return false;
    return msgs.every((msg) => messageStore.collapsedMessages[msg.id] === true);
  });

  $effect(() => {
    if (sending) showCommands = false;
  });

  function send() {
    if (!canSend) return;
    showCommands = false;
    onSend();
    value = "";
    selectedIndex = 0;
    tick().then(adjustHeight);
  }

  async function stop() {
    await messageStore.abort();
  }

  $effect(() => {
    void value;
    tick().then(adjustHeight);
  });

  $effect(() => {
    if (!sending) textarea?.focus();
  });

  function adjustHeight() {
    if (!textarea) return;
    textarea.style.height = "auto";
    if (!value.trim()) return;
    textarea.style.height = Math.min(textarea.scrollHeight, 200) + "px";
  }

  function handleInput() {
    if (value.startsWith("/")) {
      showCommands = true;
      selectedIndex = 0;
    } else {
      showCommands = false;
    }
  }

  function selectCommand(cmd: ChatCommand) {
    value = cmd.label + " ";
    showCommands = false;
    onCommand(cmd);
    tick().then(() => {
      textarea?.focus();
      if (textarea)
        textarea.selectionStart = textarea.selectionEnd = value.length;
      adjustHeight();
    });
  }

  function openCommands() {
    if (sending) return;
    value = "/";
    handleInput();
    tick().then(() => {
      textarea?.focus();
      if (textarea) {
        textarea.selectionStart = textarea.selectionEnd = value.length;
      }
    });
  }

  function toggleAllMessages() {
    messageStore.toggleAllMessages();
  }

  function handleKeydown(event: KeyboardEvent) {
    if (sending) {
      event.preventDefault();
      return;
    }
    if (isComposing && event.key === "Enter") return;

    if (showCommands && filtered.length > 0) {
      if (event.key === "ArrowDown") {
        event.preventDefault();
        selectedIndex = (selectedIndex + 1) % filtered.length;
        return;
      }
      if (event.key === "ArrowUp") {
        event.preventDefault();
        selectedIndex =
          selectedIndex === 0 ? filtered.length - 1 : selectedIndex - 1;
        return;
      }
      if (event.key === "Enter" && !event.shiftKey) {
        event.preventDefault();
        const cmd = filtered[selectedIndex];
        if (cmd) selectCommand(cmd);
        return;
      }
      if (event.key === "Escape") {
        event.preventDefault();
        showCommands = false;
        return;
      }
    }

    if (event.key === "Enter" && (event.shiftKey || event.ctrlKey)) {
      event.preventDefault();
      send();
    }
  }
</script>

<div class="relative shrink-0 border-t border-border/50 bg-muted/20 p-3">
  {#if showCommands && filtered.length > 0 && !sending}
    <ChatCommandMenu
      commands={filtered}
      {selectedIndex}
      onSelect={selectCommand}
    />
  {/if}

  <div
    class="rounded-2xl border border-input bg-background/50 transition-all duration-200 focus-within:border-primary focus-within:ring-2 focus-within:ring-primary/20 {sending
      ? 'opacity-60'
      : ''}"
  >
    <textarea
      bind:this={textarea}
      bind:value
      oninput={handleInput}
      onkeydown={handleKeydown}
      oncompositionstart={() => (isComposing = true)}
      oncompositionend={() => (isComposing = false)}
      {placeholder}
      rows="1"
      disabled={sending}
      class="chat-textarea max-h-50 w-full resize-none overflow-y-auto bg-transparent px-4 py-3 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none disabled:cursor-not-allowed"
      aria-label="消息输入框"
    ></textarea>

    <div
      class="flex items-center justify-between border-t border-border/50 px-2 py-1.5"
    >
      <div class="flex items-center gap-0.5">
        <button
          type="button"
          onclick={() => !sending && onAttach()}
          disabled={sending}
          title="附加文件"
          aria-label="附加文件"
          class="flex size-8 items-center justify-center rounded-lg text-muted-foreground transition-all duration-200 hover:bg-accent hover:text-foreground disabled:cursor-not-allowed disabled:hover:bg-transparent"
        >
          <IconPaperclip size={18} stroke={1.5} />
        </button>
        <button
          type="button"
          onclick={() => !sending && onRecord()}
          disabled={sending}
          title="语音输入"
          aria-label="语音输入"
          class="flex size-8 items-center justify-center rounded-lg text-muted-foreground transition-all duration-200 hover:bg-accent hover:text-foreground disabled:cursor-not-allowed disabled:hover:bg-transparent"
        >
          <IconMicrophone size={18} stroke={1.5} />
        </button>
        <button
          type="button"
          onclick={openCommands}
          disabled={sending}
          title="命令"
          aria-label="打开命令菜单"
          class="flex size-8 items-center justify-center rounded-lg text-muted-foreground transition-all duration-200 hover:bg-accent hover:text-foreground disabled:cursor-not-allowed disabled:hover:bg-transparent"
        >
          <IconSlash size={18} stroke={1.5} />
        </button>
        <button
          type="button"
          onclick={() => !sending && canClear && onClear()}
          disabled={sending || !canClear}
          title="清空对话"
          aria-label="清空对话"
          class="flex size-8 items-center justify-center rounded-lg text-muted-foreground transition-all duration-200 hover:bg-destructive/10 hover:text-destructive disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-muted-foreground"
        >
          <IconTrash size={18} stroke={1.5} />
        </button>
        {#if messageStore.messages.length > 0}
          <button
            type="button"
            onclick={toggleAllMessages}
            disabled={sending}
            title={allCollapsed ? "展开全部消息" : "收起全部消息"}
            aria-label={allCollapsed ? "展开全部消息" : "收起全部消息"}
            class="flex size-8 items-center justify-center rounded-lg text-muted-foreground transition-all duration-200 hover:bg-accent hover:text-foreground disabled:cursor-not-allowed disabled:hover:bg-transparent"
          >
            {#if allCollapsed}
              <IconArrowsMaximize size={18} stroke={1.5} />
            {:else}
              <IconArrowsMinimize size={18} stroke={1.5} />
            {/if}
          </button>
        {/if}
      </div>

      <Button
        size="sm"
        class="size-9 shrink-0 rounded-xl p-0 transition-all duration-200 hover:-translate-y-0.5 hover:shadow-xl disabled:hover:translate-y-0"
        onclick={sending ? stop : send}
        disabled={sending ? aborting : !canSend}
        aria-label={aborting ? "终止中" : sending ? "停止生成" : "发送消息"}
        title={aborting ? "终止中…" : sending ? "停止生成" : "发送"}
      >
        {#if aborting}
          <IconLoader2 size={18} stroke={1.5} class="animate-spin" />
        {:else if sending}
          <IconPlayerStopFilled size={16} stroke={1.5} />
        {:else}
          <IconSend size={18} stroke={1.5} />
        {/if}
      </Button>
    </div>
  </div>
</div>

<style>
  .chat-textarea {
    scrollbar-width: thin;
    scrollbar-color: hsl(var(--muted-foreground) / 0.3) transparent;
  }
  .chat-textarea::-webkit-scrollbar {
    width: 6px;
  }
  .chat-textarea::-webkit-scrollbar-track {
    background: transparent;
  }
  .chat-textarea::-webkit-scrollbar-thumb {
    background-color: hsl(var(--muted-foreground) / 0.3);
    border-radius: 12px;
  }
</style>
