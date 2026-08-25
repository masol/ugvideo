<script lang="ts">
  import ChatMessage from "$lib/components/markdown/Message.svelte";
  import { Button } from "$lib/components/ui/button";
  import * as Chat from "$lib/components/ui/chat";
  import * as Collapsible from "$lib/components/ui/collapsible";
  import { Skeleton } from "$lib/components/ui/skeleton";
  import { messageStore } from "$lib/store/local/msg.svelte";
  import autoAnimate from "@formkit/auto-animate";
  import {
    IconArrowRight,
    IconBrain,
    IconBulb,
    IconCheck,
    IconChevronDown,
    IconChevronUp,
    IconCopy,
    IconRefresh,
    IconRobot,
    IconTargetArrow,
    IconUser,
  } from "@tabler/icons-svelte";
  import { onMount, tick } from "svelte";

  let {
    onPreset = () => {},
  }: {
    onPreset?: (text: string) => void;
  } = $props();

  const presets = [
    {
      icon: IconTargetArrow,
      title: "撰写项目报告",
      desc: "规划结构 → 收集信息",
      prompt:
        "请帮我撰写一份关于当前项目的进展报告。",
    },
    {
      icon: IconRefresh,
      title: "制定学习计划",
      desc: "规划路径 → 分阶段执行",
      prompt:
        "请为我制定一个为期三个月的 Python 学习计划，包括每周具体目标。",
    },
    {
      icon: IconBulb,
      title: "优化工作流程",
      desc: "分析现状 → 提出改进",
      prompt:
        "分析我的日常工作流程，找出低效环节，提出优化方案。",
    },
  ];

  let copiedId = $state<string | null>(null);
  let copyTimer: ReturnType<typeof setTimeout> | null = null;

  let scrollContainer = $state<HTMLDivElement | null>(null);
  let userHasScrolledUp = $state(false);
  let scrollDebounceTimer: ReturnType<typeof setTimeout> | null = null;

  let expandedPhases = $state<Record<string, boolean>>({});

  function togglePhase(messageId: string) {
    expandedPhases[messageId] = !expandedPhases[messageId];
  }

  function toggleMessageCollapse(messageId: string) {
    messageStore.toggleMessage(messageId);
  }

  function copyMessage(id: string, content: string) {
    navigator.clipboard?.writeText(content);
    copiedId = id;
    if (copyTimer) clearTimeout(copyTimer);
    copyTimer = setTimeout(() => (copiedId = null), 1600);
  }

  function isUser(role: string) {
    return role === "user";
  }

  function scrollToBottom(smooth = true) {
    if (!scrollContainer) return;
    scrollContainer.scrollTo({
      top: scrollContainer.scrollHeight,
      behavior: smooth ? "smooth" : "auto",
    });
  }

  function handleScroll() {
    if (!scrollContainer) return;
    if (scrollDebounceTimer) clearTimeout(scrollDebounceTimer);

    scrollDebounceTimer = setTimeout(() => {
      if (!scrollContainer) return;
      const { scrollTop, scrollHeight, clientHeight } = scrollContainer;
      const distanceFromBottom = scrollHeight - scrollTop - clientHeight;
      userHasScrolledUp = distanceFromBottom > 100;
    }, 150);
  }

  $effect(() => {
    void messageStore.messages.length;
    void messageStore.isLoading;
    void messageStore.phaseHistory.length;

    tick().then(() => {
      if (!scrollContainer) return;

      const { scrollTop, scrollHeight, clientHeight } = scrollContainer;
      const distanceFromBottom = scrollHeight - scrollTop - clientHeight;
      if (userHasScrolledUp && distanceFromBottom > 100) return;

      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          scrollToBottom();
        });
      });
    });
  });

  onMount(() => {
    scrollToBottom(false);
  });
</script>

<div
  bind:this={scrollContainer}
  class="chat-scroll h-full w-full overflow-y-auto"
  onscroll={handleScroll}
>
  {#if messageStore.messages.length === 0}
    <div
      class="flex min-h-full flex-col items-center justify-center px-5 py-10"
    >
      <div
        class="mb-4 flex size-14 items-center justify-center rounded-2xl bg-primary/10 text-primary"
      >
        <IconRefresh size={28} stroke={1.5} />
      </div>
      <h3 class="text-center text-base font-medium text-foreground">
        UniGen 助手
      </h3>
      <p
        class="mt-2 max-w-xs text-center text-sm leading-relaxed text-muted-foreground"
      >
        输入任何任务，UniGen 会像一位严谨的工程师一样——
        <strong>先规划蓝图</strong>，验证每一步的可行性， 然后<strong
          >按步骤执行</strong
        >。 如果中途遇到问题，它会<strong>自动回溯调整</strong
        >，直到任务完整完成。 适合复杂任务，也能利用已有工作流快速上手。
      </p>

      <div class="mt-8 w-full max-w-sm space-y-2.5" use:autoAnimate>
        {#each presets as p (p.title)}
          <button
            type="button"
            onclick={() => onPreset(p.prompt)}
            class="group flex w-full items-center gap-3 rounded-2xl border border-border/50 bg-background/50 p-3.5 text-left shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:shadow-xl"
          >
            <span
              class="flex size-9 shrink-0 items-center justify-center rounded-xl bg-muted text-muted-foreground transition-all duration-200 group-hover:bg-primary/10 group-hover:text-primary"
            >
              <p.icon size={20} stroke={1.5} />
            </span>
            <span class="min-w-0 flex-1">
              <span class="block text-sm font-medium text-foreground"
                >{p.title}</span
              >
              <span class="block truncate text-xs text-muted-foreground"
                >{p.desc}</span
              >
            </span>
            <IconArrowRight
              size={16}
              stroke={1.5}
              class="shrink-0 text-muted-foreground opacity-0 transition-all duration-200 group-hover:translate-x-0.5 group-hover:opacity-100"
            />
          </button>
        {/each}
      </div>
    </div>
  {:else}
    <Chat.List class="min-h-full gap-5 px-3 py-4">
      {#each messageStore.messages as message, index (message.id + index)}
        <div class="group/msg flex min-w-0 flex-col gap-1.5">
          {#if isUser(message.role)}
            <div class="flex items-center justify-end gap-2">
              <Button
                variant="ghost"
                size="icon"
                onclick={() => copyMessage(message.id, message.content)}
                class="size-6 rounded-lg text-muted-foreground opacity-0 transition-all duration-200 group-hover/msg:opacity-100 hover:text-foreground"
                aria-label="复制消息内容"
              >
                {#if copiedId === message.id}
                  <IconCheck size={14} stroke={1.5} class="text-primary" />
                {:else}
                  <IconCopy size={14} stroke={1.5} />
                {/if}
              </Button>

              <Button
                variant="ghost"
                size="icon"
                onclick={() => toggleMessageCollapse(message.id)}
                class="size-6 rounded-lg text-muted-foreground opacity-0 transition-all duration-200 group-hover/msg:opacity-100 hover:text-foreground"
                aria-label={messageStore.collapsedMessages[message.id]
                  ? "展开消息"
                  : "折叠消息"}
              >
                {#if messageStore.collapsedMessages[message.id]}
                  <IconChevronDown size={14} stroke={1.5} />
                {:else}
                  <IconChevronUp size={14} stroke={1.5} />
                {/if}
              </Button>

              <span class="text-xs font-medium text-muted-foreground">你</span>

              <Chat.BubbleAvatar class="size-6 shrink-0">
                <Chat.BubbleAvatarFallback class="bg-primary/10 text-primary">
                  <IconUser size={15} stroke={1.5} />
                </Chat.BubbleAvatarFallback>
              </Chat.BubbleAvatar>
            </div>

            {#if !messageStore.collapsedMessages[message.id]}
              <div
                class="ml-32 min-w-0 rounded-2xl border border-primary/15 bg-primary/8 p-3 text-sm leading-relaxed text-foreground wrap-break-word transition-all duration-200"
              >
                <ChatMessage {message} />
              </div>
            {:else}
              <button
                type="button"
                onclick={() => toggleMessageCollapse(message.id)}
                class="ml-32 flex items-center gap-2 rounded-xl border border-border/50 bg-muted/20 px-3 py-2 text-xs text-muted-foreground transition-all duration-200 hover:bg-muted/40 hover:text-foreground"
                aria-label="展开消息"
              >
                <IconChevronDown size={14} stroke={1.5} />
                <span>消息已折叠 · 点击展开</span>
              </button>
            {/if}
          {:else}
            <div class="flex items-center gap-2">
              <Chat.BubbleAvatar class="size-6 shrink-0">
                <Chat.BubbleAvatarFallback
                  class="bg-muted text-muted-foreground"
                >
                  <IconRobot size={15} stroke={1.5} />
                </Chat.BubbleAvatarFallback>
              </Chat.BubbleAvatar>

              <span class="text-xs font-medium text-muted-foreground">
                助手
              </span>

              {#if message.phaseRecords && message.phaseRecords.length > 0}
                <button
                  type="button"
                  onclick={() => togglePhase(message.id)}
                  class="flex items-center gap-1 rounded-lg px-2 py-1 text-xs text-muted-foreground transition-all duration-200 hover:bg-accent hover:text-foreground"
                  aria-label={expandedPhases[message.id]
                    ? "收起思考过程"
                    : "展开思考过程"}
                >
                  <IconBrain size={14} stroke={1.5} />
                  <span>思考过程</span>
                  <IconChevronDown
                    size={14}
                    stroke={1.5}
                    class="transition-transform duration-200 {expandedPhases[
                      message.id
                    ]
                      ? 'rotate-180'
                      : ''}"
                  />
                </button>
              {/if}

              <Button
                variant="ghost"
                size="icon"
                onclick={() => toggleMessageCollapse(message.id)}
                class="size-6 rounded-lg text-muted-foreground opacity-0 transition-all duration-200 group-hover/msg:opacity-100 hover:text-foreground"
                aria-label={messageStore.collapsedMessages[message.id]
                  ? "展开消息"
                  : "折叠消息"}
              >
                {#if messageStore.collapsedMessages[message.id]}
                  <IconChevronDown size={14} stroke={1.5} />
                {:else}
                  <IconChevronUp size={14} stroke={1.5} />
                {/if}
              </Button>

              <Button
                variant="ghost"
                size="icon"
                onclick={() => copyMessage(message.id, message.content)}
                class="size-6 rounded-lg text-muted-foreground opacity-0 transition-all duration-200 group-hover/msg:opacity-100 hover:text-foreground"
                aria-label="复制消息内容"
              >
                {#if copiedId === message.id}
                  <IconCheck size={14} stroke={1.5} class="text-primary" />
                {:else}
                  <IconCopy size={14} stroke={1.5} />
                {/if}
              </Button>
            </div>

            {#if message.phaseRecords && message.phaseRecords.length > 0 && expandedPhases[message.id]}
              <div class="space-y-2 animate-fade-in">
                {#each message.phaseRecords as record (record.id)}
                  <Collapsible.Root>
                    <Collapsible.Trigger
                      class="group/phase flex w-full items-center gap-2 rounded-xl border border-border/50 bg-muted/20 px-3 py-2 text-left text-xs transition-all duration-200 hover:bg-muted/40"
                    >
                      <IconBrain
                        size={14}
                        stroke={1.5}
                        class="shrink-0 text-primary"
                      />
                      <span class="flex-1 font-medium text-foreground">
                        {record.title}
                      </span>
                      <IconChevronDown
                        size={14}
                        stroke={1.5}
                        class="shrink-0 text-muted-foreground transition-transform duration-200 group-data-[state=open]/phase:rotate-180"
                      />
                    </Collapsible.Trigger>
                    <Collapsible.Content
                      class="overflow-hidden data-[state=closed]:animate-collapsible-up data-[state=open]:animate-collapsible-down"
                    >
                      <div
                        class="mt-1 rounded-xl border border-border/50 bg-background/50 p-3 text-xs leading-relaxed text-muted-foreground"
                      >
                        <ChatMessage
                          message={{
                            id: record.id,
                            role: "assistant",
                            content: record.detail,
                            timestamp: record.timestamp,
                          }}
                        />
                      </div>
                    </Collapsible.Content>
                  </Collapsible.Root>
                {/each}
              </div>
            {/if}

            {#if !messageStore.collapsedMessages[message.id]}
              <div
                class={[
                  "min-w-0 rounded-2xl p-3 text-sm leading-relaxed wrap-break-word transition-all duration-200",
                  message.isError
                    ? "border border-destructive/30 bg-destructive/5 text-destructive"
                    : "border border-border/50 bg-muted/40 text-foreground",
                ]}
              >
                <ChatMessage {message} />
              </div>
            {:else}
              <button
                type="button"
                onclick={() => toggleMessageCollapse(message.id)}
                class="flex items-center gap-2 rounded-xl border border-border/50 bg-muted/20 px-3 py-2 text-xs text-muted-foreground transition-all duration-200 hover:bg-muted/40 hover:text-foreground"
                aria-label="展开消息"
              >
                <IconChevronDown size={14} stroke={1.5} />
                <span>消息已折叠 · 点击展开</span>
              </button>
            {/if}
          {/if}
        </div>
      {/each}

      {#if messageStore.isLoading && messageStore.phase}
        <div class="flex animate-fade-in flex-col gap-1.5">
          <div class="flex items-center gap-2">
            <Chat.BubbleAvatar class="size-6 shrink-0">
              <Chat.BubbleAvatarFallback class="bg-primary/10 text-primary">
                <IconRefresh size={15} stroke={1.5} class="animate-spin" />
              </Chat.BubbleAvatarFallback>
            </Chat.BubbleAvatar>
            <span class="text-xs font-medium text-muted-foreground">
              反思助手
            </span>
            <span class="flex gap-1" aria-label="正在思考">
              <span
                class="size-1.5 animate-bounce rounded-full bg-primary/60 [animation-delay:0ms]"
              ></span>
              <span
                class="size-1.5 animate-bounce rounded-full bg-primary/60 [animation-delay:150ms]"
              ></span>
              <span
                class="size-1.5 animate-bounce rounded-full bg-primary/60 [animation-delay:300ms]"
              ></span>
            </span>
          </div>

          <div
            class="w-full rounded-2xl border border-border/50 bg-muted/40 p-3"
          >
            <p class="text-sm font-medium text-foreground">
              {messageStore.phase.title}
            </p>
            <div class="mt-2 text-xs leading-relaxed text-muted-foreground">
              <ChatMessage
                message={{
                  id: "current-phase",
                  role: "assistant",
                  content: messageStore.phase.detail,
                  timestamp: new Date(),
                }}
              />
            </div>
          </div>
        </div>
      {:else if messageStore.isLoading}
        <div class="flex animate-fade-in flex-col gap-1.5">
          <div class="flex items-center gap-2">
            <Chat.BubbleAvatar class="size-6 shrink-0">
              <Chat.BubbleAvatarFallback class="bg-primary/10 text-primary">
                <IconRefresh size={15} stroke={1.5} class="animate-spin" />
              </Chat.BubbleAvatarFallback>
            </Chat.BubbleAvatar>
            <span class="text-xs font-medium text-muted-foreground">
              反思助手
            </span>
            <span class="flex gap-1" aria-label="正在思考">
              <span
                class="size-1.5 animate-bounce rounded-full bg-primary/60 [animation-delay:0ms]"
              ></span>
              <span
                class="size-1.5 animate-bounce rounded-full bg-primary/60 [animation-delay:150ms]"
              ></span>
              <span
                class="size-1.5 animate-bounce rounded-full bg-primary/60 [animation-delay:300ms]"
              ></span>
            </span>
          </div>

          <div
            class="w-full rounded-2xl border border-border/50 bg-muted/40 p-3"
          >
            <div class="space-y-1.5">
              <Skeleton class="h-3 w-4/5 rounded-lg" />
              <Skeleton class="h-3 w-3/5 rounded-lg" />
            </div>
          </div>
        </div>
      {/if}
    </Chat.List>
  {/if}
</div>

<style>
  .chat-scroll {
    scrollbar-width: thin;
    scrollbar-color: hsl(var(--muted-foreground) / 0.3) transparent;
  }
  .chat-scroll::-webkit-scrollbar {
    width: 8px;
  }
  .chat-scroll::-webkit-scrollbar-track {
    background: transparent;
  }
  .chat-scroll::-webkit-scrollbar-thumb {
    background-color: hsl(var(--muted-foreground) / 0.3);
    border-radius: 12px;
  }
  .chat-scroll::-webkit-scrollbar-thumb:hover {
    background-color: hsl(var(--muted-foreground) / 0.5);
  }
</style>
