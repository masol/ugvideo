<!-- src/lib/components/dyn/nodes/TextListNode.svelte -->
<script lang="ts">
  // @todo: 未来通过 schema 拓展任意数据类型，可引入 svelte-jsonschema-form 全自动化。
  import { RuntimeIcon } from "$lib/components/runtimeicon";
  import { Badge } from "$lib/components/ui/badge";
  import { Button } from "$lib/components/ui/button";
  import { ScrollArea } from "$lib/components/ui/scroll-area";
  import { i18nStore } from "$lib/store/i18n.svelte";
  import { type IValueService } from "$lib/store/ui/activity/type";
  import { confirmStore } from "$lib/store/ui/confirm.svelte";
  import { dialogStore } from "$lib/store/ui/dialog.svelte";
  import type { CacheItem } from "@app/main/types";
  import autoAnimate from "@formkit/auto-animate";
  import {
    IconAlertTriangle,
    IconBook2,
    IconLoader2,
    IconPencil,
    IconPlus,
    IconTrash,
  } from "@tabler/icons-svelte";
  import type { TextListNode } from "../ast";
  import { coerceList, useBinding } from "../binding.svelte";
  import ScriptSegmentDialog from "../dialog/TextInputDialog.svelte";

  let { node, service }: { node: TextListNode; service: IValueService } =
    $props();

  // 随 node 响应式更新；每条正文的存储 key = `${key}_${条目id}`
  let key = $derived(node.binding.key);
  const itemKey = (id: string) => `${key}_${id}`;

  const b = useBinding<CacheItem[]>(service, () => node.binding);
  let items = $derived(coerceList<CacheItem>(b.value));
  let loading = $derived(b.loading);
  let error = $derived(b.error);

  async function readItemContent(id: string): Promise<string> {
    // service 无缓冲：直接向 main 读最新正文。缺失返回空串。
    return (await service.get<string>(itemKey(id))) ?? "";
  }

  async function handleAppend() {
    if (loading) return;
    const content = await dialogStore.safeShow(
      ScriptSegmentDialog,
      { title: node.addDialogTitle ?? "添加", initialText: "" },
      { size: "xl" },
    );
    if (content === null || !content) return;
    const id = crypto.randomUUID();
    const item: CacheItem = { id, size: content.length, updatedAt: Date.now() };
    // 先写正文（原始 key，无 hook 绑定），成功后再写索引（经 b.set 更新本地）。
    await service.set(itemKey(id), content);
    await b.set([...items, item]);
  }

  async function handleEdit(item: CacheItem) {
    if (loading) return;
    const orig = await readItemContent(item.id);
    const content = await dialogStore.safeShow(
      ScriptSegmentDialog,
      {
        title: node.editDialogTitle ?? "编辑",
        description: node.editDialogDescription,
        initialText: orig,
        alert: node.editAlert,
      },
      { size: "xl" },
    );
    if (content === null) return;
    const next = items.map((s) =>
      s.id === item.id
        ? { ...s, size: content.length, updatedAt: Date.now() }
        : s,
    );
    await service.set(itemKey(item.id), content);
    await b.set(next);
  }

  async function handleDelete(item: CacheItem, index: number) {
    if (loading) return;
    const ok = await confirmStore.request({
      title: node.confirmTitle ?? "删除",
      message:
        node.confirmMessage ??
        `确定要删除第 ${index + 1} 项吗？此操作无法撤销。`,
    });
    if (!ok) return;
    const next = items.filter((s) => s.id !== item.id);
    await service.rm(itemKey(item.id));
    await b.set(next);
  }
</script>

<div class="space-y-3">
  {#if error}
    <div
      class="flex items-start gap-2 rounded-xl border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive"
      role="alert"
    >
      <IconAlertTriangle size={16} stroke={1.5} class="mt-0.5 shrink-0" />
      <span class="whitespace-pre-wrap wrap-break-word">{error}</span>
    </div>
  {/if}

  <Button
    class="w-full rounded-xl shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:shadow-xl"
    onclick={handleAppend}
    disabled={loading}
  >
    {#if loading}
      <IconLoader2 size={18} stroke={1.5} class="animate-spin" />
      处理中…
    {:else}
      <IconPlus size={18} stroke={1.5} />
      {node.addLabel}
    {/if}
  </Button>

  <ScrollArea class="h-87.5 pr-2">
    {#if items.length > 0}
      <div
        use:autoAnimate
        class="space-y-3 transition-opacity duration-200"
        class:pointer-events-none={loading}
        class:opacity-60={loading}
        aria-busy={loading}
      >
        {#each items as item, i (item.id)}
          <div
            class="group relative rounded-2xl border border-border/50 bg-card p-6 shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:shadow-xl"
          >
            <div class="flex items-center gap-2">
              <Badge
                variant="secondary"
                class="rounded-lg px-2 py-0.5 text-xs font-medium"
              >
                第 {i + 1} 项
              </Badge>
              <span class="text-xs text-muted-foreground">
                {item.size ?? 0} 字
              </span>
            </div>
            {#if item.updatedAt}
              <p
                class="whitespace-pre-wrap text-xs leading-relaxed text-muted-foreground opacity-70 line-clamp-4"
              >
                {i18nStore.dayjs(item.updatedAt).fromNow()}
              </p>
            {/if}
            <div
              class="absolute right-4 top-4 flex gap-1 opacity-0 transition-opacity duration-200 group-hover:opacity-100"
            >
              <Button
                size="icon"
                variant="ghost"
                class="h-7 w-7 rounded-lg"
                onclick={() => handleEdit(item)}
                disabled={loading}
                aria-label="编辑"
              >
                <IconPencil size={14} stroke={1.5} />
              </Button>
              <Button
                size="icon"
                variant="ghost"
                class="h-7 w-7 rounded-lg text-muted-foreground hover:text-destructive"
                onclick={() => handleDelete(item, i)}
                disabled={loading}
                aria-label="删除"
              >
                <IconTrash size={14} stroke={1.5} />
              </Button>
            </div>
          </div>
        {/each}
      </div>
    {:else if loading}
      <div
        class="flex flex-col items-center justify-center rounded-2xl border border-dashed border-border/50 bg-muted/20 p-12 text-center"
      >
        <IconLoader2
          size={20}
          stroke={1.5}
          class="animate-spin text-muted-foreground"
        />
      </div>
    {:else}
      <div
        class="flex flex-col items-center justify-center rounded-2xl border border-dashed border-border/50 bg-muted/20 p-12 text-center"
      >
        <div
          class="mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-primary/10 text-primary"
        >
          {#if node.emptyIcon}
            <RuntimeIcon name={node.emptyIcon} size={20} stroke={1.5} />
          {:else}
            <IconBook2 size={20} stroke={1.5} />
          {/if}
        </div>
        <p class="text-sm font-medium">{node.emptyTitle}</p>
      </div>
    {/if}
  </ScrollArea>
</div>
