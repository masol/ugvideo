import { z } from 'zod';

/**
 * "带 ID 的数组项" —— 推荐的数组元素形态。
 * 每个元素带唯一 id(UUID)，便于按 id 做 upsert / 定位。
 * item 为可选实际载荷(可能为 null)。
 * loose(): 允许携带额外字段，不会被过滤。
 */
export const IdentifiedItemSchema = z.object({
    id: z.string(),
}).loose();

export type IdentifiedItem = z.input<typeof IdentifiedItemSchema>;



export const CacheItemSchema = IdentifiedItemSchema.extend({
    size: z.number().optional(),
    updatedAt: z.union([z.number(), z.string()]).optional(),
});

// 派生对应的 TypeScript 类型
export type CacheItem = z.infer<typeof CacheItemSchema>;