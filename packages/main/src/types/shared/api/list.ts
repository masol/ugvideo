import { z } from 'zod';

// 1. Define the BlueprintKind enum/union
export const BlueprintKindSchema = z.union([
    z.literal('glossary'),
    z.literal('metag'),
    z.literal('capa')
]);

// 2. Define the QueryParams schema
export const QueryParamsSchema = z.object({
    kind: BlueprintKindSchema,
    name: z.string().optional(),
    pageIndex: z.number(),
    pageSize: z.number(),
});

// 3. Infer types from schemas
export type BlueprintKind = z.infer<typeof BlueprintKindSchema>;
export type QueryParams = z.infer<typeof QueryParamsSchema>;


export const ListItemSchema = z.object({
    name: z.string(),
    updatedAt: z.string(),
    on: z.string().nullish().optional(), // object name-- 也就是capa的name字段。其它表不返回。用于renderer判断是否可编辑内容的。
});
export type ListItem = z.infer<typeof ListItemSchema>;

// 统一的响应体 Schema（不再需要复杂的 union）
export const GetListResponseSchema = z.object({
    total: z.number().nonnegative(),
    pageIndex: z.number().nonnegative(),
    pageSize: z.number().positive(),
    items: z.array(ListItemSchema),
});
export type GetListResponse = z.infer<typeof GetListResponseSchema>;



export const GetItemInputSchema = z.object({
    kind: BlueprintKindSchema,
    id: z.string(),
    noThrow: z.boolean().optional(), // 是否抛出异常。
    content: z.boolean(),  // 指示获取对象自身，还是获取对象的内容(部分格式无内容)
});
// 从 Zod 推衍类型
export type GetItemInput = z.infer<typeof GetItemInputSchema>;



export const SetItemSchema = z.object({
    kind: BlueprintKindSchema,
    id: z.string(),
    content: z.string(),
    code: z.boolean().optional(),  // 指示这里的content，是对象的内容(部分格式无内容)还是对象自身。
});
export type SetItem = z.infer<typeof SetItemSchema>;
