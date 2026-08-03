// src/lib/components/dyn/ast.ts
/**
 * 动态面板 AST。type 决定渲染组件，容器有 children。
 */
import type { AccordionSectionNode, ButtonGroupNode, ButtonOption, DynNode, FieldNode, ImageGridNode, ListItemView, MarkdownNode, OptionBadge, PanelNode, SelectNode, SelectOption, TextListNode, TreeAction, TreeLevel, TreeNode } from "@app/main/types";


export type { AccordionSectionNode, ButtonGroupNode, ButtonOption, DynNode, FieldNode, ImageGridNode, ListItemView, MarkdownNode, OptionBadge, PanelNode, SelectNode, SelectOption, TextListNode, TreeAction, TreeLevel, TreeNode };


/** 递归/循环用的稳定 key：优先 binding.key，其次 title，最后交由调用方补 index */
export function keyOf(node: DynNode, index: number): string {
    if ("binding" in node && node.binding?.key) return node.binding.key;
    if ("title" in node && node.title) return node.title;
    return `${node.type}-${index}`;
}