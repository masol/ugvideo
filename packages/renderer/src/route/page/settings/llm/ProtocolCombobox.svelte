<!-- ProtocolCombobox.svelte -->
<script lang="ts">
  import * as Command from "$lib/components/ui/command";
  import * as Popover from "$lib/components/ui/popover";
  import { cn } from "$lib/utils";
  import { PinyinFuseSearch, type SearchItem } from "$lib/utils/fuse";
  import { allProtocols, type ProviderProtocol } from "$lib/utils/model/types";
  import { IconCheck, IconChevronDown, IconSearch } from "@tabler/icons-svelte";

  interface ProtocolOption {
    id: ProviderProtocol;
    label: string;
    description: string;
  }

  const PROTOCOL_OPTIONS: ProtocolOption[] = [
    {
      id: allProtocols.openai,
      label: "OpenAI",
      description: "标准 OpenAI 协议，兼容绝大多数模型。",
    },
    {
      id: allProtocols.openaiCompatible,
      label: "OpenAI 兼容",
      description: "用于不完全符合 OpenAI 规范的兼容接口。",
    },
    {
      id: allProtocols.anthropic,
      label: "Anthropic",
      description: "Claude 系列专用协议。",
    },
    {
      id: allProtocols.vertex,
      label: "Google AI",
      description: "Google Gemini / Vertex AI 协议。",
    },
    {
      id: allProtocols.xai,
      label: "xAI",
      description: "Grok 系列专用协议。",
    },
    {
      id: allProtocols.deepseek,
      label: "DeepSeek",
      description: "DeepSeek 专用协议。",
    },
    {
      id: allProtocols.alibaba,
      label: "阿里",
      description: "阿里云百炼兼容协议。",
    },
    {
      id: allProtocols.seedance,
      label: "豆包（seedance）",
      description: "视频生成采用即梦协议，文本生成自动切换为 OpenAI 兼容模式。",
    },
    {
      id: allProtocols.kling,
      label: "可灵（Kling）",
      description: "仅支持图像和视频模型。",
    },
    {
      id: allProtocols.comfy,
      label: "Comfy",
      description: "ComfyUI 工作流调度协议。",
    },
  ];

  const protocolMap = new Map(PROTOCOL_OPTIONS.map((o) => [o.id, o]));

  // ── 构建拼音搜索索引（模块级常量，只构建一次）──
  const searchItems: SearchItem[] = PROTOCOL_OPTIONS.map((o) => ({
    id: o.id,
    text: `${o.label} ${o.description}`,
  }));
  const fuse = new PinyinFuseSearch(searchItems);

  type Props = {
    protocol?: ProviderProtocol;
    onchange?: (protocol: ProviderProtocol) => void;
  };

  let {
    protocol = $bindable<ProviderProtocol | undefined>(undefined),
    onchange,
  }: Props = $props();

  let open = $state(false);
  let query = $state("");
  let triggerWidth = $state(0);
  let triggerHeight = $state(40);

  // 弹层关闭时清空查询
  $effect(() => {
    if (!open) query = "";
  });

  const selectedOption = $derived(
    protocol ? protocolMap.get(protocol) : undefined,
  );

  // 根据拼音搜索结果（空查询时显示全部）
  const filteredOptions = $derived.by(() => {
    const q = query.trim();
    if (!q) return PROTOCOL_OPTIONS;
    const ids = fuse.search(q);
    return ids
      .map((id) => protocolMap.get(id as ProviderProtocol))
      .filter(Boolean) as ProtocolOption[];
  });

  function select(id: ProviderProtocol) {
    protocol = id;
    open = false;
    onchange?.(id);
  }
</script>

<div
  class="relative"
  bind:clientWidth={triggerWidth}
  bind:clientHeight={triggerHeight}
>
  <Popover.Root bind:open>
    <Popover.Trigger>
      {#snippet child({ props })}
        <button
          {...props}
          type="button"
          class={cn(
            "flex h-9 w-full items-center gap-2 rounded-xl border border-input bg-background px-3 text-sm",
            "transition-all duration-200 hover:bg-muted/30",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
            open && "pointer-events-none opacity-0",
          )}
        >
          <IconSearch class="size-4 shrink-0 text-muted-foreground" />
          {#if selectedOption}
            <span class="min-w-0 flex-1 truncate text-left">
              {selectedOption.label}
            </span>
            <span class="shrink-0 text-xs text-muted-foreground">
              {selectedOption.id}
            </span>
          {:else}
            <span class="min-w-0 flex-1 text-left text-muted-foreground">
              选择协议...
            </span>
          {/if}
          <IconChevronDown
            class={cn(
              "size-4 shrink-0 text-muted-foreground transition-transform duration-200",
              open && "rotate-180",
            )}
          />
        </button>
      {/snippet}
    </Popover.Trigger>

    <Popover.Content
      class="overflow-hidden rounded-xl border border-border/60 bg-popover p-0 shadow-xl animate-fade-in"
      align="start"
      side="bottom"
      sideOffset={-triggerHeight}
      style="width: {triggerWidth}px; z-index: 9999;"
    >
      <!-- shouldFilter={false}：由拼音搜索接管过滤 -->
      <Command.Root shouldFilter={false}>
        <Command.Input
          bind:value={query}
          placeholder="搜索协议..."
          class="h-10"
        />
        <!-- pt-1 让首行与搜索框之间留出呼吸空间 -->
        <Command.List class="max-h-72 pt-1">
          {#if filteredOptions.length === 0}
            <Command.Empty>未找到匹配的协议</Command.Empty>
          {:else}
            {#each filteredOptions as option (option.id)}
              <Command.Item
                value={option.id}
                onSelect={() => select(option.id)}
              >
                <div class="min-w-0 flex-1 space-y-0.5">
                  <p class="truncate text-sm font-medium">
                    {option.label}
                  </p>
                  <p class="truncate text-xs text-muted-foreground">
                    {option.description}
                  </p>
                </div>
                {#if protocol === option.id}
                  <IconCheck class="ml-auto size-4 shrink-0 text-primary" />
                {/if}
              </Command.Item>
            {/each}
          {/if}
        </Command.List>
      </Command.Root>
    </Popover.Content>
  </Popover.Root>
</div>
