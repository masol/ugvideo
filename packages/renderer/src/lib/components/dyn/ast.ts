// src/lib/components/dyn/ast.ts —— 顶部改为从 binding 导入
/**
 * 动态面板 AST。type 决定渲染组件，容器有 children。
 *
 * 【节点作者指南 —— 扩充新节点四步】
 *  ① 在此文件加 `XxxNode` 接口，并入 `DynNode` 联合。
 *     需要读写数据的节点必放 `binding: Binding`（见 ./binding.ts）。
 *     纯视觉修饰（徽章文本/色类名/图标名）属于「数据」，作为字段进 AST，
 *     不要写死在组件里。
 *  ② 写 `nodes/Xxx.svelte`，props 恒为 `{ node, service }`。
 *     读写数据一律经 `useBinding(service, () => node.binding)`——它自动处理
 *     异步加载 / main 静默变更同步 / 卸载注销 / readonly。
 *  ③ registry.ts 注册 `type → 组件` 一行；dispatcher 无需改。
 *  ④ 若节点走「文件资源」（按目录，而非 key），用 dir 字段 + service.file*，
 *     见 ImageGridNode。
 *
 * 【铁律】
 *  - 完全任务中立：默认文案皆通用中性词，业务语义只来自 JSON 字段。
 *  - JSON 未提供的字段一律不渲染，不用业务缺省填充。
 *  - 不引入人工 id；列表 key 由 binding.key / index 生成。
 */
import type { AccordionSectionNode, ButtonGroupNode, ButtonOption, DynNode, FieldNode, ImageGridNode, ListItemView, MarkdownNode, OptionBadge, PanelNode, SelectNode, SelectOption, TextListNode, TreeAction, TreeLevel, TreeNode } from "@app/main/types";


export type { AccordionSectionNode, ButtonGroupNode, ButtonOption, DynNode, FieldNode, ImageGridNode, ListItemView, MarkdownNode, OptionBadge, PanelNode, SelectNode, SelectOption, TextListNode, TreeAction, TreeLevel, TreeNode };


/** 递归/循环用的稳定 key：优先 binding.key，其次 title，最后交由调用方补 index */
export function keyOf(node: DynNode, index: number): string {
    if ("binding" in node && node.binding?.key) return node.binding.key;
    if ("title" in node && node.title) return node.title;
    return `${node.type}-${index}`;
}