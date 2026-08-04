// $lib/components/glossary/glossary-columns.ts
import { renderComponent } from "$lib/components/ui/data-table/index.js";
import type { ColumnDef } from "@tanstack/table-core";
import GlossaryNameCell from "./name-cell.svelte";
import GlossaryRowActions from "./row-actions.svelte";
import type { BlueprintTerm } from "./store.svelte.js";
import GlossaryTimeCell from "./time-cell.svelte";

/**
 * meta.class 同时承担「单元格对齐/截断类」。
 * meta.sortable 告诉 Table.Head 该列是否渲染排序按钮。
 */
// type HeaderSortMeta = {
//     class?: string;
//     sortable?: BlueprintSortBy;
// };

export const glossaryColumns: ColumnDef<BlueprintTerm>[] = [
    {
        id: "actions",
        enableHiding: false,
        enableSorting: false,
        enableResizing: false,
        size: 40,
        meta: { class: "w-10" },
        cell: ({ row }) =>
            renderComponent(GlossaryRowActions, { term: row.original }),
    },
    {
        accessorKey: "name",
        header: "名称",
        // min-w-0 让 truncate 真正生效（默认 flex 容器默认 min-w-auto 会撑破）
        // flex-1 允许该列动态伸缩，size 仅作为初始建议，不再强行占位
        meta: { class: "min-w-0 flex-1", sortable: "key" },
        // 名称列：调小初始宽度，将更多空间留给 flex-1 动态分配
        size: 200,
        enableResizing: true,
        cell: ({ row }) =>
            renderComponent(GlossaryNameCell, { name: row.original.name }),
    },
    {
        accessorKey: "updatedAt",
        header: "更新时间",
        meta: { class: "w-36 text-end", sortable: "updatedAt" },
        // 时间字段宽度紧凑且固定（fromNow + 箭头 + 兜底 ISO 提示）
        size: 144,
        enableResizing: true,
        cell: ({ row }) =>
            renderComponent(GlossaryTimeCell, { value: row.original.updatedAt }),
    },
];