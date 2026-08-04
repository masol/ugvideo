// packages/main/src/libs/project/controllers/drizzle/list.ts
import * as schema from '$libs/utils/db/schema/index.js';
import { GetListResponse, ListItem, QueryParams } from '$types/shared/api/list.js';
import { asc, desc, like, sql } from 'drizzle-orm';
import Logger from 'electron-log/main.js';
import type { DrizzleDBType } from './type.js';

// 配置映射
const KIND_CONFIG = {
    glossary: {
        table: schema.kvStore,
        filterColumn: schema.kvStore.key,          // 主键列
        selectFields: { name: schema.kvStore.key, updatedAt: schema.kvStore.updatedAt },
        supportsFts: true,
    },
    metag: {
        table: schema.metag,
        filterColumn: schema.metag.fieldKey,       // 主键列
        selectFields: { name: schema.metag.fieldKey, updatedAt: schema.metag.updatedAt },
        supportsFts: false,
    },
    capa: {
        table: schema.capabilities,
        filterColumn: schema.capabilities.id,      // 主键列
        selectFields: { name: schema.capabilities.id, updatedAt: schema.capabilities.updatedAt, on: schema.capabilities.name },
        supportsFts: false,
    },
} as const;

export function getList(
    db: DrizzleDBType,
    params: QueryParams
): GetListResponse {
    const {
        pageIndex,
        pageSize,
        kind,
        sortBy = 'key',
        sortOrder = 'asc',
    } = params;
    let { name, searchMode } = params;

    const config = KIND_CONFIG[kind];
    const table = config.table;
    const filterColumn = config.filterColumn;
    const selectFields = config.selectFields;
    const supportsFts = config.supportsFts;

    // ----- 自动检测搜索模式 -----
    if (name && !searchMode) {
        const trimmed = name.trim();
        if (trimmed.startsWith('*')) {
            searchMode = 'fulltext';
            name = trimmed.slice(1).trim();
        } else if (trimmed.includes(' ')) {
            searchMode = 'fulltext';
            name = trimmed;
        } else {
            searchMode = 'prefix';
        }
    }
    if (!searchMode) searchMode = 'prefix';

    // ----- 降级处理 -----
    if (searchMode === 'fulltext' && !supportsFts) {
        Logger.warn(
            `[list] Kind "${kind}" does not support fulltext search, falling back to prefix mode.`
        );
        searchMode = 'prefix';
    }

    // ----- 构建 WHERE 条件 -----
    let whereCondition;
    if (name) {
        if (searchMode === 'fulltext' && supportsFts) {
            // 直接使用表名字符串，因为 kv_store_fts 不在 schema 中定义
            whereCondition = sql`${schema.kvStore.key} IN (
        SELECT key FROM kv_store_fts WHERE key MATCH ${name}
      )`;
        } else {
            whereCondition = like(filterColumn, `${name}%`);
        }
    }

    // ----- 排序 -----
    const orderColumn = sortBy === 'updatedAt' ? selectFields.updatedAt : filterColumn;
    const orderFn = sortOrder === 'desc' ? desc : asc;

    // ----- 总数 -----
    const totalResult = db
        .select({ count: sql<number>`count(*)` })
        .from(table)
        .where(whereCondition)
        .all();
    const total = totalResult[0]?.count ?? 0;

    // ----- 分页列表 -----
    const items = db
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        .select(selectFields as any)
        .from(table)
        .where(whereCondition)
        .orderBy(orderFn(orderColumn))
        .limit(pageSize)
        .offset(pageIndex * pageSize)
        .all() as ListItem[];

    return {
        total,
        items,
        pageIndex,
        pageSize,
    };
}