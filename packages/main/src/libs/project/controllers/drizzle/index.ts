import * as schema from '$libs/utils/db/schema/index.js';
import Database from 'better-sqlite3';
import { eq, inArray } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { app } from "electron";
import Logger from "electron-log/main.js";
import { ensureDir, pathExists } from "fs-extra";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import { metaDirName, type EmbedKVStore, type IProjectContext } from "../../type.js";
// import { PrjJob } from "../../helper/job.js";
import { metagFromJson, metagToJson, type MetagRow, type NewMetagRow } from '$libs/blueprint/metag/is.js';
import { throwNotfound, throwNotimplement, throwPrecondition } from "$libs/utils/err.js";
import type { Capability, NewCapability } from "$types/blueprint/capability.js";
import type { PrjTimeStamps, PrjTimeStore } from "$types/prjstore.js";
import { BlueprintKind, GetItemInput, GetListResponse, QueryParams, SetItem } from '$types/shared/api/list.js';
import { BaseProjectController } from "../base.js";
import { deleteCapabilityById, getCapabilityById, getCapaTimestamps, upsertCapability as upcertCapability } from './capa.js';
import { getList } from './list.js';
import { deleteMetag, getMetag, getMetagTimestamps, upcertMetag } from './metag.js';
import type { DrizzleDBType } from "./type.js";

const dbName = 'db.sqlite'

export class PrjDB extends BaseProjectController implements EmbedKVStore {
    private migrationsPath: string = ""
    private dqlite: Database.Database | null = null;
    private db: DrizzleDBType | null = null;

    // 设置关注了kvstore中哪些值的变动，这些值的变化，将通知客户端。
    private subKeys: Set<string> = new Set();
    // #job: PrjJob | null = null;
    constructor(ctx: IProjectContext) {
        super(ctx)
        const __dirname = dirname(fileURLToPath(import.meta.url));
        this.migrationsPath = app.isPackaged
            ? join(process.resourcesPath, 'drizzle') // 生产环境：拷贝的物理路径
            //当前路径是dist中。
            : join(__dirname, '../src/libs/utils/db/migrations');

        Logger.info(`[Project:DB] migrationsPath= ${this.migrationsPath}`)
    }

    static ensure(ctx: IProjectContext): PrjDB { return this.coreEnsure(this, ctx); }

    ensureDB(): DrizzleDBType {
        if (!this.db) {
            throwPrecondition("Drizzle数据库未初始化。")
        }
        return this.db;
    }

    close() {
        // if (this.#job) {
        //     this.#job.forceShutdown();
        // }
        this.clearSubs();
        if (this.dqlite && this.dqlite.open) {
            try {
                Logger.info('[Database] 正在安全断开数据库连接，写入 WAL 缓冲区...');

                // 优化：在关闭前强制执行一次检查点，把内存和 WAL 日志中的数据彻底刷入磁盘
                this.dqlite.pragma('wal_checkpoint(TRUNCATE)');
                this.dqlite.close();
                this.dqlite = null;
                this.db = null;
                Logger.debug('[Database] 数据库已成功关闭，文件锁已释放。');
            } catch (error) {
                Logger.error('[Database] 关闭数据库时发生错误:', error);
            }
        }
    }

    async open(bCreate: boolean = false): Promise<void> {
        const dbPath = join(this.ctx.path, metaDirName, dbName);
        const exists = await pathExists(dbPath);
        if (!exists) {
            if (!bCreate) {
                throwNotfound(`项目“${this.ctx.path}”的数据库不存在！`)
            }
            await ensureDir(join(this.ctx.path, metaDirName));
        }
        // 关闭，如果存在旧数据。
        this.close();

        this.dqlite = new Database(dbPath, {
            // 加入超时，防止在多进程或密集写入时死锁
            timeout: 5000
        });

        // 1. 明确关闭外键约束（SQLite 默认其实是 OFF，这里显式关闭确保性能最大化）
        this.dqlite.pragma('foreign_keys = OFF');

        // 2. 开启 WAL 模式（预写日志模式：读写不互斥，写入速度直接飙升数倍）
        this.dqlite.pragma('journal_mode = WAL');

        // 3. 将同步模式设为 NORMAL
        // 在 WAL 模式下，NORMAL 非常安全，它不会每次都强制把数据刷入磁盘，而是写到操作系统的缓存中，性能极高
        this.dqlite.pragma('synchronous = NORMAL');

        // 4. 增大缓存大小（单位是页，4000 约等于 16MB 的内存缓存，减少频繁读写磁盘）
        this.dqlite.pragma('cache_size = 4000');

        // 5. 将临时文件存在内存中，而不是磁盘
        this.dqlite.pragma('temp_store = MEMORY');

        this.db = drizzle(this.dqlite, { schema });
        migrate(this.db, { migrationsFolder: this.migrationsPath });
        // this.#job = new PrjJob(this.dqlite);
        // await this.#job.init();
    }

    // 1. 让检查方法直接返回非空的 DrizzleType
    private getInitedDB(): DrizzleDBType {
        if (!this.db) {
            throw new Error("项目数据库未初始化");
        }
        return this.db;
    }

    // 术语表中key的默认规范： #开头的为节点创建的术语，_开头的是资源表。其它为程序定义或用户输入的术语。
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    set(key: string, value: any): void {
        const db = this.getInitedDB();
        db.insert(schema.kvStore)
            .values({ key, value })
            .onConflictDoUpdate({
                target: schema.kvStore.key,
                set: { value },
            })
            .run(); // 同步执行，执行完后此行代码才向下走
        if (this.subKeys.has(key)) {
            this.ctx.notify("kv-changed", { key, value })
        }
    }

    clearSubs() {
        this.subKeys.clear();
    }

    addSub(key: string) {
        this.subKeys.add(key);
    }

    rmSub(key: string) {
        this.subKeys.delete(key);
    }


    remove(key: string): void {
        const db = this.getInitedDB();
        db.delete(schema.kvStore)
            .where(eq(schema.kvStore.key, key))
            .run();
    }

    get<T>(key: string): T | null {
        const db = this.getInitedDB();
        const result = db
            .select({ value: schema.kvStore.value })
            .from(schema.kvStore)
            .where(eq(schema.kvStore.key, key))
            .get();

        return result ? (result.value as T) : null;
    }

    getWithTime<T>(key: string): PrjTimeStore<T> | null {
        const db = this.getInitedDB();
        const result = db
            .select({ value: schema.kvStore.value, updatedAt: schema.kvStore.updatedAt })
            .from(schema.kvStore)
            .where(eq(schema.kvStore.key, key))
            .get();

        return result ? ({
            value: result.value as T,
            updatedAt: result.updatedAt
        }) : null;
    }

    /**
     * 获取keyStore中对应key的更新时间（支持单个或批量查询）。
     * @param key 单个 key (string) 或多个 key (string[])
     * @returns 如果传入 string，返回 string | null；如果传入 string[]，返回 Record<string, string> (key-value 映射表)
     */
    geUpdTime(key: string): string | null;
    geUpdTime(key: string[]): Record<string, string>;
    geUpdTime(key: string | string[]): string | null | Record<string, string> {
        const db = this.getInitedDB();

        // 1. 处理数组参数（批量查询）
        if (Array.isArray(key)) {
            if (key.length === 0) return {};

            const results = db
                .select({
                    key: schema.kvStore.key,
                    updatedAt: schema.kvStore.updatedAt
                })
                .from(schema.kvStore)
                .where(inArray(schema.kvStore.key, key))
                .all(); // 使用 all() 获取所有匹配行

            // 将结果转换为对象映射，方便外部 O(1) 复杂度查询
            return results.reduce((acc, row) => {
                if (row.updatedAt) {
                    acc[row.key] = row.updatedAt;
                }
                return acc;
            }, {} as Record<string, string>);
        }

        // 2. 处理单个字符串参数（保持原逻辑，使用 eq 和 get）
        const result = db
            .select({ updatedAt: schema.kvStore.updatedAt })
            .from(schema.kvStore)
            .where(eq(schema.kvStore.key, key))
            .get();

        return result?.updatedAt || null;
    }

    // 返回id.
    upcertCapa(capability: NewCapability): string {
        return upcertCapability(this.ensureDB(), capability);
    }

    getCapaById(id: string): Capability | null {
        return getCapabilityById(this.ensureDB(), id);
    }

    rmCapaById(id: string): void {
        return deleteCapabilityById(this.ensureDB(), id);
    }

    getCapaTimes(id: string): PrjTimeStamps | null {
        return getCapaTimestamps(this.ensureDB(), id);
    }

    getMetag(id: string | string[]): (MetagRow | null)[] {
        return getMetag(this.ensureDB(), id);
    }

    rmMetag(id: string | string[]): void {
        deleteMetag(this.ensureDB(), id);
    }

    upcertMetag(metags: NewMetagRow | NewMetagRow[]): void {
        upcertMetag(this.ensureDB(), metags);
    }

    getMetagTimes(id: string | string[]): (PrjTimeStamps | null)[] {
        return getMetagTimestamps(this.ensureDB(), id);
    }

    list<K extends BlueprintKind>(input: QueryParams & { kind: K }): GetListResponse {
        return getList(this.ensureDB(), input)
    }

    getContent({ kind, id, content, noThrow }: GetItemInput): string {
        switch (kind) {
            case 'capa': {
                const capa = this.getCapaById(id);
                if (!capa) {
                    if (!noThrow) {
                        throwNotfound(`没有id为“${id}”的能力。`)
                    }
                    return ""
                }
                // 如果 content 为 true，返回完整的 code
                if (content) {
                    return capa.code;
                }
                // 使用解构剔除不需要的字段，保留其余属性
                // eslint-disable-next-line @typescript-eslint/no-unused-vars
                const { updatedAt, createdAt, code, ...safeCapa } = capa;

                return JSON.stringify(safeCapa, null, 2);
            }
            case 'glossary':
                {
                    const value = this.get<string>(id);
                    if (value === null) {
                        if (!noThrow) {
                            throwNotfound(`没有key为“${id}”的术语。`)
                        }
                        return ""
                    }
                    // 资源类的不做JSON化，直接默认其是字符串。content为true，在export时发出，方便存储。
                    if (content || id.startsWith('_')) {
                        return value;
                    }
                    return JSON.stringify(value, null, 2) // 这是为了方便编辑器。
                }
            case 'metag':
                {
                    const value = this.getMetag(id)[0];
                    if (value === null) {
                        if (!noThrow) {
                            throwNotfound(`没有fieldKey为“${id}”的元术语。`)
                        }
                        return ""
                    }
                    // 使用解构剔除不需要的字段，保留其余属性
                    const { updatedAt, createdAt, ...jsonValue } = metagToJson(value)!
                    void (updatedAt)
                    void (createdAt)
                    return JSON.stringify(jsonValue, null, 2);
                }
            default:
                if (!noThrow) {
                    throwNotimplement(`试图获取未支持的kind:${kind}`)
                }
                return ''
        }
    }

    // 返回id.
    setContent({ kind, id, content, code }: SetItem): string {
        switch (kind) {
            case 'capa': {
                if (code) {
                    const newCapa = {
                        id,
                        code: content
                    }
                    return this.upcertCapa(newCapa);
                }
                const cntJson = JSON.parse(content);
                const newCapa = { ...cntJson, id }
                {
                    // eslint-disable-next-line @typescript-eslint/no-unused-vars
                    const { code, ...rest } = newCapa;
                    return this.upcertCapa(rest)
                }
            }
            case 'glossary':
                {
                    if (id.startsWith('_') || code) {
                        this.set(id, content);
                    } else {
                        const cntJson = JSON.parse(content);
                        this.set(id, cntJson);
                    }
                    return id
                }
            case 'metag':
                {
                    const cntJson = JSON.parse(content);
                    const metag = metagFromJson(cntJson);
                    this.upcertMetag({
                        ...metag,
                        fieldKey: id
                    })
                    return id
                }
            default:
                throwNotimplement(`试图写入未支持的kind:${kind}`)
        }
    }

    // 返回验证错误字符串。
    verifyContent(_setInfo: SetItem): string[] {
        throwNotimplement("尚未实现内容验证，自行小心。")
    }

    dispose(): void {
        this.close();
    }
}
