<!--
  ╭─────────────────────────────────────────────────────╮
  │ [Tree 递归分支节点 → TreeBranch.svelte]              │
  │ 职责：渲染树的单个节点，容器懒订阅 baseKey 展开子层， │
  │       叶子点击后按 actions 顺序回调 onAction          │
  ╰─────────────────────────────────────────────────────╯
-->
<script lang="ts">
  import { RuntimeIcon } from "$lib/components/runtimeicon";
  import { Skeleton } from "$lib/components/ui/skeleton";
  import * as TreeView from "$lib/components/ui/tree-view";
  import type { IValueService } from "$lib/store/ui/activity/type";
  import autoAnimate from "@formkit/auto-animate";
  import type { TreeAction, TreeNode } from "../ast";
  import { useBinding } from "../binding.svelte";
  import Self from "./TreeBranch.svelte";
  import {
    buildActionContext,
    coerceChildrenFromUnknown,
    interpolate,
    nodeLabel,
    type RootFields,
    type TreeItem,
  } from "./tree-util";

  let {
    node,
    service,
    depth,
    item,
    index,
    parentKey,
    rootFields,
    onAction,
  }: {
    node: TreeNode;
    service: IValueService;
    depth: number;
    item: TreeItem;
    index: number;
    parentKey: string;
    rootFields: RootFields;
    onAction: (ctx: {
      action: TreeAction;
      name: string;
      key: string;
      args: Record<string, unknown> | undefined;
      depth: number;
      itemId: string;
    }) => Promise<void> | void;
  } = $props();

  const level = $derived(node.levels[depth] ?? {});
  const isLeaf = $derived(level.leaf ?? depth >= node.levels.length - 1);
  const track = $derived(node.track ?? true);

  // baseKey：自身字段可参与占位（{label}、{meta}），跨级字段 {root.<f>}
  const baseKey = $derived(
    interpolate(level.keyTemplate ?? "{parent}_{id}", {
      parent: parentKey,
      id: item.id,
      label: item.label,
      meta: item.meta,
      root: rootFields,
    }),
  );

  const label = $derived(nodeLabel(level, item, index, rootFields));

  let open = $state(false);

  // 仅「容器 + 已展开」时订阅 → 真正的按需加载 + 变化实时跟随。
  const b = useBinding(service, () => ({
    key: !isLeaf && open ? baseKey : "",
    track,
  }));
  const children = $derived(
    coerceChildrenFromUnknown(b.value, level.childRegex),
  );
  const childLoading = $derived(b.loading);

  async function runActions() {
    const actions = level.actions ?? [];
    for (const action of actions) {
      const ctx = buildActionContext({
        action,
        baseKey,
        parentKey,
        item,
        index,
        rootFields,
      });
      await onAction({ action, ...ctx, depth, itemId: item.id });
    }
  }
</script>

{#if isLeaf}
  <TreeView.File name={label} onclick={runActions}>
    {#snippet icon()}
      <RuntimeIcon name={level.icon ?? "IconFileText"} size={14} stroke={1.5} />
    {/snippet}
  </TreeView.File>
{:else}
  <TreeView.Folder name={label} bind:open>
    {#snippet icon({ open: isOpen })}
      <RuntimeIcon
        name={isOpen
          ? (level.openIcon ?? level.icon ?? "IconFolderOpen")
          : (level.icon ?? "IconFolder")}
        size={14}
        stroke={1.5}
      />
    {/snippet}

    {#if open}
      {#if childLoading}
        <div class="space-y-2 py-1 pl-2">
          {#each Array.from({ length: 3 }) as _, i (i)}
            <Skeleton class="h-7 w-full rounded-lg" />
          {/each}
        </div>
      {:else}
        <div use:autoAnimate>
          {#each children as child, i (child.id)}
            <Self
              {node}
              {service}
              depth={depth + 1}
              item={child}
              index={i}
              parentKey={baseKey}
              {rootFields}
              {onAction}
            />
          {/each}
        </div>
      {/if}
    {/if}
  </TreeView.Folder>
{/if}
