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
      title: "诊断当前工作流",
      desc: "分析现有 AI 工作流可能存在的质量瓶颈",
      prompt: "请审查当前项目的 AI 工作流，指出可能影响产出质量的薄弱环节。",
    },
    {
      icon: IconRefresh,
      title: "提出改进方案",
      desc: "让助手重构工作流并说明改动原因",
      prompt:
        "请针对当前工作流提出一套具体的改进方案，并逐条说明每处改动的理由与预期收益。",
    },
    {
      icon: IconBulb,
      title: "追问改进思路",
      desc: "理解 AI 为什么这样调整",
      prompt: "你上一步为什么这样改进工作流？还有没有更优的替代做法？",
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

  // ✅ 修复：等待 autoAnimate 动画完成后再滚动
  $effect(() => {
    void messageStore.messages.length;
    void messageStore.isLoading;
    void messageStore.phaseHistory.length;

    tick().then(() => {
      if (!scrollContainer) return;

      // 如果用户主动向上滚动超过 100px，不自动滚动
      const { scrollTop, scrollHeight, clientHeight } = scrollContainer;
      const distanceFromBottom = scrollHeight - scrollTop - clientHeight;
      if (userHasScrolledUp && distanceFromBottom > 100) return;

      // ✅ 双重 requestAnimationFrame 确保 autoAnimate 完成
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
        class="mb-4 flex size-14 items-center justify-center rounded-2xl bg-primary/10 text-primary transition-all duration-200"
      >
        <IconRefresh size={28} stroke={1.5} />
      </div>
      <h3 class="text-center text-base font-medium text-foreground">
        工作流反思助手
      </h3>
      <p
        class="mt-2 max-w-xs text-center text-sm leading-relaxed text-muted-foreground"
      >
        描述你对项目质量的期望，助手会反思并改进当前项目的 AI
        工作流。你也可以随时追问它「为什么这样改」。
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
              <span class="block text-sm font-medium text-foreground">
                {p.title}
              </span>
              <span class="block truncate text-xs text-muted-foreground">
                {p.desc}
              </span>
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
        <div class="group/msg flex min-w-0 flex-col gap-1.5" use:autoAnimate>
          <div
            class={[
              "flex items-center gap-2",
              isUser(message.role) && "flex-row-reverse",
            ]}
          >
            <Chat.BubbleAvatar class="size-6 shrink-0">
              {#if isUser(message.role)}
                <Chat.BubbleAvatarFallback class="bg-primary/10 text-primary">
                  <IconUser size={15} stroke={1.5} />
                </Chat.BubbleAvatarFallback>
              {:else}
                <Chat.BubbleAvatarFallback
                  class="bg-muted text-muted-foreground"
                >
                  <IconRobot size={15} stroke={1.5} />
                </Chat.BubbleAvatarFallback>
              {/if}
            </Chat.BubbleAvatar>

            <span class="text-xs font-medium text-muted-foreground">
              {isUser(message.role) ? "你" : "反思助手"}
            </span>

            {#if !isUser(message.role) && message.phaseRecords && message.phaseRecords.length > 0}
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

          <div
            class={[
              "w-full min-w-0 rounded-2xl p-3 text-sm leading-relaxed wrap-break-word",
              message.isError
                ? "border border-destructive/30 bg-destructive/5 text-destructive"
                : isUser(message.role)
                  ? "border border-primary/15 bg-primary/8 text-foreground"
                  : "border border-border/50 bg-muted/40 text-foreground",
            ]}
          >
            <ChatMessage {message} />
          </div>
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
