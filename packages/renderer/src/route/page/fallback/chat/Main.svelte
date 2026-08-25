<!-- src/lib/components/chat/Main.svelte -->
<script lang="ts">
  import { configStore } from "$lib/store/config.svelte";
  import { messageStore } from "$lib/store/local/msg.svelte";
  import { projectStore } from "$lib/store/project.svelte";
  import { confirmStore } from "$lib/store/ui/confirm.svelte";
  import {
    IconBulb,
    IconFolderOpen,
    IconRefresh,
    IconTargetArrow,
  } from "@tabler/icons-svelte";
  import { toast } from "svelte-sonner";
  import ChatInput from "./ChatInput.svelte";
  import ChatMessageList from "./ChatMessageList.svelte";
  import type { ChatCommand } from "./commands";

  let inputValue = $state("");

  let hasProject = $derived((projectStore.path?.length ?? 0) > 0);

  async function handleSend() {
    const content = inputValue.trim();
    if (!content || messageStore.isLoading) return;

    if (content === "/clear") {
      inputValue = "";
      await handleClear();
      return;
    }

    if (!configStore.silentSave) {
      const confirm = await confirmStore.request({
        title: "项目可能无法运行",
        message: `AI反思会引发工作流变动，有概率导致本项目无法执行，确定要继续吗？`,
        confirmLabel: "继续",
      });
      if (!confirm) {
        return;
      }
    }

    messageStore.addMessage({ role: "user", content });
    inputValue = "";
    await messageStore.AIResponse(content);
  }

  async function handleClear() {
    if (!messageStore.hasMessages || messageStore.isLoading) return;
    messageStore.clear();
  }

  function handleCommand(cmd: ChatCommand) {
    if (cmd.id === "clear") {
      inputValue = "";
      void handleClear();
    }
  }

  function handlePreset(text: string) {
    inputValue = text;
  }

  function handleAttach() {
    toast.warning("附加文件功能尚未实现");
  }

  function handleRecord() {
    toast.warning("语音输入功能尚未实现");
  }

  const capabilities = [
    {
      icon: IconTargetArrow,
      title: "诊断工作流瓶颈",
      desc: "分析项目固有 AI 工作流中影响产出质量的薄弱环节",
    },
    {
      icon: IconRefresh,
      title: "反思并自动改进",
      desc: "把你的自然语言要求转化为指令，重构工作流并执行",
    },
    {
      icon: IconBulb,
      title: "解释改进理由",
      desc: "随时追问「为什么这样改」，理解每一处调整的动机",
    },
  ];
</script>

<div class="flex h-full w-full flex-col">
  {#if hasProject}
    <div class="flex-1 min-h-0 overflow-hidden">
      <ChatMessageList onPreset={handlePreset} />
    </div>

    <ChatInput
      bind:value={inputValue}
      canClear={messageStore.hasMessages}
      onSend={handleSend}
      onCommand={handleCommand}
      onAttach={handleAttach}
      onRecord={handleRecord}
      onClear={handleClear}
    />
  {:else}
    <div
      class="flex h-full flex-col items-center justify-center overflow-y-auto px-6 py-10 text-center"
    >
      <div
        class="mb-4 flex size-16 items-center justify-center rounded-2xl bg-primary/10 text-primary"
      >
        <IconRefresh size={32} stroke={1.5} />
      </div>
      <h3 class="text-lg font-medium tracking-tight text-foreground">
        UniGen 助手
      </h3>
      <p class="mt-2 max-w-xs text-sm leading-relaxed text-muted-foreground">
        输入任何任务，UniGen 会像一位严谨的工程师一样——
        先规划蓝图，验证每一步的可行性， 然后按步骤执行。
        如果中途遇到问题，它会自动回溯调整，直到任务完整完成。
        适合复杂任务，也能利用已有工作流快速上手。
      </p>

      <div class="mt-7 w-full max-w-xs space-y-2.5 text-left">
        {#each capabilities as c (c.title)}
          <div
            class="flex items-start gap-3 rounded-2xl border border-border/50 bg-background/50 p-3.5"
          >
            <span
              class="flex size-9 shrink-0 items-center justify-center rounded-xl bg-muted text-muted-foreground"
            >
              <c.icon size={18} stroke={1.5} />
            </span>
            <span class="min-w-0 flex-1">
              <span class="block text-sm font-medium text-foreground">
                {c.title}
              </span>
              <span class="block text-xs leading-relaxed text-muted-foreground">
                {c.desc}
              </span>
            </span>
          </div>
        {/each}
      </div>

      <div
        class="mt-7 flex items-center gap-2 rounded-full border border-dashed border-border bg-muted/30 px-4 py-2 text-xs text-muted-foreground"
      >
        <IconFolderOpen size={16} stroke={1.5} class="text-primary" />
        <span>请先在主控台打开一个项目，助手即可开始工作</span>
      </div>
    </div>
  {/if}
</div>
