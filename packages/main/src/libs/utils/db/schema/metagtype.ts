import { customType } from 'drizzle-orm/sqlite-core';
import Logger from 'electron-log/main.js';
import { z } from 'zod';

/* ==============================================================
 *   自定义列类型：Zod Schema ⇄ JSON 双向转换 (针对 schema 列)
 * ============================================================== */

/**
 * 单列级 zod-schema 编解码器。
 * - 存储态：JSON Schema 字符串（SQLite TEXT）
 * - 运行态：活的 z.ZodTypeAny 实例
 */
export const zodSchemaJsonType = customType<{
    data: z.ZodTypeAny;
    driverData: string;
}>({
    dataType() {
        return 'text';
    },
    toDriver(value: z.ZodTypeAny): string {
        return JSON.stringify(z.toJSONSchema(value));
    },
    fromDriver(value: string): z.ZodTypeAny {
        try {
            const parsed = JSON.parse(value);
            return z.fromJSONSchema(parsed);
        } catch (e) {
            Logger.error('Failed to parse zodSchemaJsonType from database:', value, e);
            // 兜底返回一个宽松 schema，避免解码失败让整行取不出来
            return z.any();
        }
    },
});