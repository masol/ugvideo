<!-- src/lib/components/dyn/nodes/TreeNode.svelte -->
<script lang="ts">
  import { RuntimeIcon } from "$lib/components/runtimeicon";
  import { Skeleton } from "$lib/components/ui/skeleton";
  import * as TreeView from "$lib/components/ui/tree-view";
  import type { IValueService } from "$lib/store/ui/activity/type";
  import autoAnimate from "@formkit/auto-animate";
  import { IconListTree } from "@tabler/icons-svelte";
  import type { TreeAction, TreeNode } from "../ast";
  import { useBinding } from "../binding.svelte";
  import TreeBranch from "./TreeBranch.svelte";
  import { parseRoot } from "./tree-util";

  let { node, service }: { node: TreeNode; service: IValueService } = $props();

  const track = $derived(node.track ?? true);

  // 根 KV 订阅（变化时整棵树刷新——因为根字段可能变了）
  const b = useBinding(service, () => ({ key: node.rootKey, track }));
  let rawRoot = $derived(b.value);
  let rootLoading = $derived(b.loading);
  let rootError = $derived(b.error);

  // 根解析：字符串 → 根节点列表 + 根字段
  const parsedRoot = $derived.by(() => {
    if (typeof rawRoot !== "string") {
      return { items: [], rootFields: {} } as ReturnType<typeof parseRoot>;
    }
    return parseRoot(rawRoot, node.rootRegex);
  });

  /** 给业务方的动作回调：接整条 TreeAction + 已解析的上下文。 */
  async function onAction(ctx: {
    action: TreeAction;
    name: string;
    key: string;
    args: Record<string, unknown> | undefined;
    depth: number;
    itemId: string;
  }) {
    // TODO: 你的实现 —— 按 ctx.name 分发到对应的业务函数
    //  例：switch (ctx.name) { case "logOpen": ...; case "viewPlan": ...; }
    void ctx;
  }
</script>

<div class="space-y-3">
  {#if rootError}
    <div
      class="flex items-start gap-2 rounded-xl border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive"
      role="alert"
    >
      <span class="whitespace-pre-wrap wrap-break-word">{rootError}</span>
    </div>
  {/if}

  {#if rootLoading}
    <div class="space-y-2">
      {#each Array.from({ length: 5 }) as _, i (i)}
        <Skeleton class="h-8 w-full rounded-xl" />
      {/each}
    </div>
  {:else if parsedRoot.items.length > 0}
    <TreeView.Root>
      <div use:autoAnimate>
        {#each parsedRoot.items as item, i (item.id)}
          <TreeBranch
            {node}
            {service}
            depth={0}
            {item}
            index={i}
            parentKey={node.rootKey}
            rootFields={parsedRoot.rootFields}
            {onAction}
          />
        {/each}
      </div>
    </TreeView.Root>
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
          <IconListTree size={20} stroke={1.5} />
        {/if}
      </div>
      <p class="text-sm font-medium">{node.emptyTitle}</p>
    </div>
  {/if}
</div>
