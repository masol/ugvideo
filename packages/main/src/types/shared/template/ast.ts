import { z } from "zod";
import { bindingSchema } from "./binding.js";

/* ── 共享子结构 ── */

/** 列表项的可选展示字段，全部由 service 数据提供，AST 不预设业务含义 */
export const listItemViewSchema = z.object({
    id: z.string(),
    /** 主标题；缺省用「第 N 项」 */
    label: z.string().optional(),
    /** 次要元信息（如时间、大小），纯展示，缺省不显示 */
    meta: z.string().optional(),
});
export type ListItemView = z.infer<typeof listItemViewSchema>;

/** 选项徽章：视觉修饰完全由 AST 描述（原 hint/short/tone/swatch 的统一形态） */
export const optionBadgeSchema = z.object({
    /** 文本徽章内容；无则视为纯色块徽章 */
    text: z.string().optional(),
    /** 徽章附加类名（渐变、配色等） */
    className: z.string().optional(),
});
export type OptionBadge = z.infer<typeof optionBadgeSchema>;

export const selectOptionSchema = z.object({
    value: z.string(),
    label: z.string(),
    sub: z.string().optional(),
    badge: optionBadgeSchema.optional(),
});
export type SelectOption = z.infer<typeof selectOptionSchema>;

export const buttonOptionSchema = z.object({
    value: z.string(),
    label: z.string(),
    sub: z.string().optional(),
    /** 状态色点类名 */
    dot: z.string().optional(),
});
export type ButtonOption = z.infer<typeof buttonOptionSchema>;

/* ── 叶子节点（非递归，独立导出便于复用/精确校验） ── */

export const textListNodeSchema = z.object({
    type: z.literal("text-list"),
    binding: bindingSchema,
    addLabel: z.string(),
    emptyTitle: z.string(),
    emptyIcon: z.string().optional(),
    /** 弹窗组件由外部注册，这里只给文案 */
    addDialogTitle: z.string().optional(),
    editDialogTitle: z.string().optional(),
    editDialogDescription: z.string().optional(),
    editAlert: z.boolean().optional(),
    /** 删除确认文案，缺省用通用中性词 */
    confirmTitle: z.string().optional(),
    confirmMessage: z.string().optional(),
});
export type TextListNode = z.infer<typeof textListNodeSchema>;

export const fieldNodeSchema = z.object({
    type: z.literal("field"),
    binding: bindingSchema,
    label: z.string(),
    editor: z.enum(["inline", "dialog"]),
    placeholder: z.string().optional(),
    emptyHint: z.string().optional(),
    dialogTitle: z.string().optional(),
    dialogDescription: z.string().optional(),
    alert: z.boolean().optional(),
    /** 只读：可展示、不可编辑 */
    readonly: z.boolean().optional(),
});
export type FieldNode = z.infer<typeof fieldNodeSchema>;

export const imageGridNodeSchema = z.object({
    type: z.literal("image-grid"),
    binding: bindingSchema,
    /** 文件资源相对目录（图片存放位置），文件操作必需 */
    dir: z.string(),
    addLabel: z.string(),
    emptyTitle: z.string(),
    emptyHint: z.string().optional(),
    emptyIcon: z.string().optional(),
    confirmTitle: z.string().optional(),
    confirmMessage: z.string().optional(),
});
export type ImageGridNode = z.infer<typeof imageGridNodeSchema>;

export const selectNodeSchema = z.object({
    type: z.literal("select"),
    binding: bindingSchema,
    label: z.string(),
    icon: z.string().optional(),
    options: z.array(selectOptionSchema),
    /** 读值无效时的回退 */
    fallback: z.string(),
});
export type SelectNode = z.infer<typeof selectNodeSchema>;

export const buttonGroupNodeSchema = z.object({
    type: z.literal("button-group"),
    binding: bindingSchema,
    label: z.string(),
    icon: z.string().optional(),
    options: z.array(buttonOptionSchema),
    fallback: z.string(),
    columns: z.number().optional(),
});
export type ButtonGroupNode = z.infer<typeof buttonGroupNodeSchema>;

/** 直接渲染 markdown 内容的节点 */
export const markdownNodeSchema = z.object({
    type: z.literal("markdown"),
    /** 内联 markdown 源文；与 binding 二选一 */
    content: z.string().optional(),
    /** 从 service 读取 markdown 源（动态内容） */
    binding: bindingSchema.optional(),
    /** 是否流式渲染（如 LLM 输出） */
    streaming: z.boolean().optional(),
    /** 错误风格 */
    error: z.boolean().optional(),
});
export type MarkdownNode = z.infer<typeof markdownNodeSchema>;

/* ── Tree（进度树 / 分散 key 树） ────────────────────────────────
 *
 * 与容器节点不同：tree 不用嵌套 children 描述层级，而用「分层 key 模板」。
 *  - rootKey 的值是字符串（可由 rootRegex 提取节点数组 + 字段），整段注入到
 *    所有层的 fields（占位符 root.<name> 引用）。
 *  - 每一层 levels[depth] 用 keyTemplate 从父节点推导本层节点的 baseKey，
 *    占位符 {parent}=父节点 baseKey，{id}=本节点 id，{key}=父 baseKey（与
 *    parent 等价但语义不同层级），以及 {index}/{n}/{label}/{meta} 和 root.<f>。
 *  - 容器节点的 baseKey 值 = 其子节点数组（可由本层 childRegex 提取）。
 *  - 展开容器时才订阅其 baseKey（track 默认开）→ 按需加载 + 数据变化实时跟随。
 *  - 叶子点击按 actions 顺序触发：每个 action 的 name/type 决定调用哪个函数，
 *    keyTemplate 决定要读的 key，args 是额外透传参数。
 */

/** 树的一个动作；可多个，按序执行。name 或 type 至少给一个。 */
export const treeActionSchema = z.object({
    /** 动作名（业务方注册的函数名）；与 type 二选一 */
    name: z.string().optional(),
    /** 动作类型；缺省 = name；为兼容历史保留 */
    type: z.string().optional(),
    /** 读取内容的 key 模板；缺省用节点自身 baseKey。
     *  占位符：{key}=节点 baseKey，{parent}=父节点 baseKey，{id}=节点 id，{label}
     */
    keyTemplate: z.string().optional(),
    /** 额外参数，原样透传给动作函数 */
    args: z.record(z.string(), z.unknown()).optional(),
});
export type TreeAction = z.infer<typeof treeActionSchema>;

/** 树的一层定义，数组下标 = 深度（0 为根节点层） */
export const treeLevelSchema = z.object({
    /**
     * 由父节点推导本层节点 baseKey 的模板。
     * 占位符：{parent}=父节点 baseKey（根层为 rootKey），{id}=本节点 id，{key} 同 parent，
     *        以及本节点自身字段 {label} {meta} 与跨级字段 {root.<f>}。
     * 缺省 "{parent}_{id}"。
     */
    keyTemplate: z.string().optional(),
    /**
     * 节点标题模板。占位符：{id}、{label}、{meta}、{index}(0 基)、{n}(1 基)、{root.<f>}。
     * 缺省用 item.label，否则「第 N 项」。
     */
    labelTemplate: z.string().optional(),
    /** 节点图标名 */
    icon: z.string().optional(),
    /** 容器展开态图标名 */
    openIcon: z.string().optional(),
    /** 本层是否叶子（无更深子层）。缺省：最后一层自动视为叶子 */
    leaf: z.boolean().optional(),
    /** 提取本层子节点的正则；匹配容器节点 baseKey 的字符串值（未指定 = 整段当数组解析）。
     *  命名捕获：id / label / meta；其它命名捕获自动注入到子节点 fields 与本层 fields。
     *  分组顺序约定：[1]=id, [2]=label, [3]=meta；与命名捕获等价，命名优先。
     */
    childRegex: z.string().optional(),
    /** 本层节点点击动作链（通常叶子层设置） */
    actions: z.array(treeActionSchema).optional(),
});
export type TreeLevel = z.infer<typeof treeLevelSchema>;

export const treeNodeSchema = z.object({
    type: z.literal("tree"),
    /** 根 KV key，其值（字符串）会被正则/整体解析为根层节点 */
    rootKey: z.string(),
    /**
     * 根 KV 值 → 根节点列表 的提取正则。
     * - 不给：整段 = 单一根节点（id="root"，无 label/meta），或按行 split 后逐行匹配。
     * - 命名捕获优先：id / label / meta；其它命名捕获 → root.<name> 字段，全层可引用。
     */
    rootRegex: z.string().optional(),
    /** 是否监听 key 变化并自动刷新，缺省 true（进度树通常需要实时） */
    track: z.boolean().optional(),
    /** 各层定义 */
    levels: z.array(treeLevelSchema),
    emptyTitle: z.string(),
    emptyIcon: z.string().optional(),
});
export type TreeNode = z.infer<typeof treeNodeSchema>;

/* ── 递归节点：先声明 TS 类型，再用 z.lazy 回填 ── */

export interface PanelNode {
    type: "panel";
    children: DynNode[];
}

export interface AccordionSectionNode {
    type: "accordion-section";
    title: string;
    icon?: string;
    defaultOpen?: boolean;
    /** "count" = 自动取第一个 list 子节点长度 */
    badge?: string;
    children: DynNode[];
}

export type DynNode =
    | PanelNode
    | AccordionSectionNode
    | TextListNode
    | FieldNode
    | ImageGridNode
    | SelectNode
    | ButtonGroupNode
    | MarkdownNode
    | TreeNode;

export const panelNodeSchema: z.ZodType<PanelNode> = z.lazy(() =>
    z.object({
        type: z.literal("panel"),
        children: z.array(dynNodeSchema),
    }),
);

export const accordionSectionNodeSchema: z.ZodType<AccordionSectionNode> = z.lazy(() =>
    z.object({
        type: z.literal("accordion-section"),
        title: z.string(),
        icon: z.string().optional(),
        defaultOpen: z.boolean().optional(),
        badge: z.string().optional(),
        children: z.array(dynNodeSchema),
    }),
);

/**
 * 递归联合：因分支含递归节点，使用 z.union 而非 discriminatedUnion。
 * z.lazy 保证前向引用可解析；显式 z.ZodType<DynNode> 消除推断歧义。
 */
export const dynNodeSchema: z.ZodType<DynNode> = z.lazy(() =>
    z.union([
        panelNodeSchema,
        accordionSectionNodeSchema,
        textListNodeSchema,
        fieldNodeSchema,
        imageGridNodeSchema,
        selectNodeSchema,
        buttonGroupNodeSchema,
        markdownNodeSchema,
        treeNodeSchema,
    ]),
);