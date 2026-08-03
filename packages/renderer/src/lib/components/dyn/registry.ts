/* eslint-disable @typescript-eslint/no-explicit-any */
// src/lib/components/dyn/registry.ts
import type { Component } from "svelte";

import AccordionSectionNode from "./nodes/AccordionSectionNode.svelte";
import ButtonGroupNode from "./nodes/ButtonGroupNode.svelte";
import FieldNode from "./nodes/FieldNode.svelte";
import ImageGridNode from "./nodes/ImageGridNode.svelte";
// 【待补】MarkdownNode 已在 ast.ts 的 DynNode 联合中，但缺少 nodes/MarkdownNode.svelte
// 组件文件。补齐组件后，在此加：
//   import MarkdownNode from "./nodes/MarkdownNode.svelte";
//   并在 NODE_REGISTRY 中注册 "markdown": MarkdownNode
// 在补齐前，JSON 中出现 type:"markdown" 会命中 NodeRenderer 的「未知节点」兜底。
import PanelNode from "./nodes/PanelNode.svelte";
import SelectNode from "./nodes/SelectNode.svelte";
import TextListNode from "./nodes/TextListNode.svelte";
import TreeNode from "./nodes/TreeNode.svelte";

/** type → 组件。新增节点在此注册一行，dispatcher 不用动 */
export const NODE_REGISTRY: Record<string, Component<any>> = {
    panel: PanelNode,
    "accordion-section": AccordionSectionNode,
    "text-list": TextListNode,
    field: FieldNode,
    "image-grid": ImageGridNode,
    select: SelectNode,
    "button-group": ButtonGroupNode,
    tree: TreeNode,
    // "markdown": MarkdownNode,  // 待补组件后启用（见上方说明）
};

export function resolveNode(type: string): Component<any> | null {
    return NODE_REGISTRY[type] ?? null;
}