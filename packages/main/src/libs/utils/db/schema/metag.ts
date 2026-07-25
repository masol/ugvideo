import { sql } from 'drizzle-orm';
import { sqliteTable, text } from 'drizzle-orm/sqlite-core';
import { zodSchemaJsonType } from "./metagtype.js";

export const metag = sqliteTable('metag', {
    /** 主键：fieldKey (全局唯一) */
    fieldKey: text('field_key').primaryKey(),

    intent: text('intent'),
    
    // // dimesion信息(order)--当前版本只维护直接的dims拆分，无限递归的dims，需要使用SLD Resolution来合一(比如使用swi-prolog).
    dims: text('dims', { mode: 'json' })
        .$type<string[]>()
        .notNull()
        .default(sql`'[]'`),

    // dims(order)还是放到capability了，概念上，应该放在这里。
    /** schema 通过 customType 自动 Zod<->JSON 转译 */
    schema: zodSchemaJsonType('schema'),

    createdAt: text('created_at')
        .notNull()
        .default(sql`CURRENT_TIMESTAMP`)
        .$defaultFn(() => new Date().toISOString()),

    updatedAt: text('updated_at')
        .notNull()
        .default(sql`CURRENT_TIMESTAMP`)
        .$defaultFn(() => new Date().toISOString())
        .$onUpdate(() => new Date().toISOString()),
});

