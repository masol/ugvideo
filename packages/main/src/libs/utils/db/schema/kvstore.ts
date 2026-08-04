// packages/main/src/libs/utils/db/schema/kvstore.ts
import { sql } from 'drizzle-orm';
import { index, sqliteTable, text } from 'drizzle-orm/sqlite-core';

export const kvStore = sqliteTable(
    'kv_store',
    {
        key: text('key').primaryKey(),
        value: text('value', { mode: 'json' })
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            .$type<Record<string, any> | any[] | string | number | boolean>()
            .notNull(),
        updatedAt: text('updated_at')
            .default(sql`CURRENT_TIMESTAMP`)
            .$defaultFn(() => new Date().toISOString())
            .$onUpdate(() => new Date().toISOString()),
    },
    (table) => [
        index('idx_kv_store_updated_at').on(table.updatedAt),
    ]
);