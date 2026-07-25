import { z } from 'zod';

/**
 * "带 ID 的数组项" —— 推荐的数组元素形态。
 * 每个元素带唯一 id(UUID)，便于按 id 做 upsert / 定位。
 * item 为可选实际载荷(可能为 null)。
 * loose(): 允许携带额外字段，不会被过滤。
 */
export const IdentifiedItemSchema = z.object({
    id: z.string(),
    item: z.any().optional(),
}).loose();

export type IdentifiedItem = z.input<typeof IdentifiedItemSchema>;