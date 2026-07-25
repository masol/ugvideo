import { throwNotfound, throwPrecondition } from "$libs/utils/err.js";
import type { Connection, Table, VectorQuery } from "@lancedb/lancedb";
import Logger from "electron-log/main.js";
import { UUID } from "node:crypto";
import type { ILanceDB } from "./type.js";

export abstract class TableBase {
    protected table: Table | null = null;
    readonly name: string;

    constructor(protected lancedb: ILanceDB, name: string) {
        this.name = name;
    }

    close(): void {
        if (this.table) {
            try {
                this.table.close();
            } catch (e) {
                Logger.warn(`[LanceDB] 表 [${this.name}] 关闭异常:`, e);
            }
            this.table = null;
        }
    }

    /** 子类负责创建 schema、建索引 */
    abstract loadTable(): Promise<void>;

    async init(db: Connection): Promise<void> {
        const tables = await db.tableNames();

        if (tables.includes(this.name)) {
            Logger.debug(`[LanceDB] 表 [${this.name}] 已存在，正在打开...`);
            this.table = await db.openTable(this.name);
            Logger.debug(`[LanceDB] 表 [${this.name}] 打开成功。`);
        } else {
            Logger.debug(`[LanceDB] 表 [${this.name}] 不存在，开始创建...`);
            await this.loadTable();
            Logger.debug(`[LanceDB] 表 [${this.name}] 创建并初始化索引成功。`);
        }
    }

    ensureTable(): Table {
        const t = this.table;
        if (!t) {
            throwNotfound(`[LanceDB] 表 [${this.name}] 未加载`);
        }
        return t;
    }

    // @TODO: kv-store切换使用sqlite. lanceDB退化为retrieval
    async getById<T = Record<string, unknown>>(id: UUID): Promise<T[]> {
        // 去掉 "-"
        const hex = id.replace(/-/g, "");
        const result = await this.ensureTable()
            .query()
            .where(`id = x'${hex}'`)
            .limit(1)
            .toArray();

        return (result ?? []) as T[];
    }

    /**
     * 托管式添加：自动向量化写入
     * - 无 text 的项跳过 embedding，直接写入（vector 置空）
     * - @todo 超出 token 限制未处理，后续需增加自动截断/分块
     * see https://docs.lancedb.com/embedding
     */
    public async autoAdd(
        items: Array<{ text?: string;[key: string]: unknown }>
    ): Promise<void> {
        if (!items || items.length === 0) return;

        const table = this.ensureTable();

        // 分流：需要 embedding 的 与 不需要的
        const needEmbedIdx: number[] = [];
        const textsToEmbed: string[] = [];

        items.forEach((item, i) => {
            const t = typeof item.text === "string" ? item.text.trim() : "";
            if (t.length > 0) {
                needEmbedIdx.push(i);
                textsToEmbed.push(t);
            }
        });

        // 仅对有文本的批量 embedding
        let vectors: number[][] = [];
        if (textsToEmbed.length > 0) {
            // @todo 超出 token 限制未处理，需要在 doEmbedding 内做自动截断/分块
            vectors = await this.lancedb.doEmbedding(textsToEmbed, "document");
        }

        // 回填
        const vectorMap = new Map<number, number[]>();
        needEmbedIdx.forEach((originIdx, k) =>
            vectorMap.set(originIdx, vectors[k])
        );

        const recordsToInsert = items.map((item, i) => {
            const vec = vectorMap.get(i);
            return vec ? { ...item, vector: vec } : { ...item };
        });

        await table.add(recordsToInsert);
    }

    /**
     * 自动转换并检索：支持 vector / fts / hybrid
     * see https://docs.lancedb.com/embedding
     *
     * @param queryText 查询文本
     * @param opts      检索配置
     *   - mode: "vector" | "fts" | "hybrid"（默认 "vector"）
     *   - limit: 返回条数（默认 10）
     *   - ftsColumn: FTS 的字段名（默认 "text"，需已建 FTS 索引）
     *   - filter: SQL where 过滤条件
     *   - select: 返回字段裁剪
     */
    public async autoSearch(
        queryText: string,
        opts: {
            mode?: "vector" | "fts" | "hybrid";
            limit?: number;
            ftsColumn?: string;
            filter?: string;
            select?: string[];
        } = {}
    ): Promise<VectorQuery> {
        const {
            mode = "vector",
            limit = 10,
            ftsColumn = "text",
            filter,
            select,
        } = opts;

        const q = (queryText ?? "").trim();
        if (!q) {
            throwPrecondition("autoSearch: queryText 不能为空");
        }

        const table = this.ensureTable();

        // 按模式构建 query
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        let query: any;
        switch (mode) {
            case "fts": {
                // 纯全文检索：无需 embedding
                query = table.search(q, ftsColumn);
                break;
            }
            case "hybrid": {
                // 混合检索：需要 vector + fts 双索引已建立
                const [queryVector] = await this.lancedb.doEmbedding([q], "query");
                query = table
                    .query()
                    .fullTextSearch(q, { columns: [ftsColumn] })
                    .nearestTo(queryVector);
                break;
            }
            case "vector":
            default: {
                const [queryVector] = await this.lancedb.doEmbedding([q], "query");
                query = table.vectorSearch(queryVector);
                break;
            }
        }

        if (filter) query = query.where(filter);
        if (select && select.length > 0) query = query.select(select);
        query = query.limit(limit);

        return query as VectorQuery;
    }
}

export type TableConstructor<T extends TableBase = TableBase> = new (
    lancedb: ILanceDB,
    name: string
) => T;