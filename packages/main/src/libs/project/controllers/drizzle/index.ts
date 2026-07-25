import { metagFromJson, metagToJson, type MetagRow, type NewMetagRow } from '$libs/blueprint/metag/is.js';
import * as schema from '$libs/utils/db/schema/index.js';
import { throwNotfound, throwNotimplement, throwPrecondition } from "$libs/utils/err.js";
import type { Capability, NewCapability } from "$types/blueprint/capability.js";
import type { PrjTimeStamps, PrjTimeStore } from "$types/prjstore.js";
import { BlueprintKind, GetItemInput, GetListResponse, QueryParams, SetItem } from '$types/shared/api/list.js';
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
import { BaseProjectController } from "../base.js";
import { deleteCapabilityById, getCapabilityById, getCapaTimestamps, upsertCapability as upcertCapability } from './capa.js';
import { getList } from './list.js';
import { deleteMetag, getMetag, getMetagTimestamps, upcertMetag } from './metag.js';
import type { DrizzleDBType } from "./type.js";

const dbName = 'db.sqlite'

export class PrjDB extends BaseProjectController implements EmbedKVStore {
    static readonly serviceKey = Symbol.for('project.controller.PrjDB');

    private migrationsPath: string = ""
    private dqlite: Database.Database | null = null;
    private db: DrizzleDBType | null = null;

    private subKeys: Set<string> = new Set();

    constructor(ctx: IProjectContext) {
        super(ctx)
        const __dirname = dirname(fileURLToPath(import.meta.url));
        this.migrationsPath = app.isPackaged
            ? join(process.resourcesPath, 'drizzle')
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

    /**
     * 强制关闭数据库，幂等。用于异常路径下的资源清理。
     * 与 close() 不同的是：即便 db 为 null，也会清理其他内部状态。
     */
    forceClose(): void {
        this.clearSubs();
        if (this.dqlite) {
            try {
                Logger.info('[Database] 强制断开数据库连接...');
                if (this.dqlite.open) {
                    try {
                        this.dqlite.pragma('wal_checkpoint(TRUNCATE)');
                    } catch (_) {
                        // 忽略 checkpoint 失败
                    }
                    this.dqlite.close();
                }
            } catch (error) {
                Logger.error('[Database] 强制关闭数据库时发生错误:', error);
            } finally {
                this.dqlite = null;
                this.db = null;
            }
        }
    }

    close() {
        this.forceClose();
        Logger.debug('[Database] 数据库已成功关闭，文件锁已释放。');
    }

    async open(bCreate: boolean = false): Promise<void> {
        const dbPath = join(this.ctx.path, metaDirName, dbName);
        const exists = await pathExists(dbPath);
        if (!exists) {
            if (!bCreate) {
                throwNotfound(`项目"${this.ctx.path}"的数据库不存在！`)
            }
            await ensureDir(join(this.ctx.path, metaDirName));
        }

        // 关闭，如果存在旧数据。
        this.forceClose();

        this.dqlite = new Database(dbPath, {
            timeout: 5000
        });

        this.dqlite.pragma('foreign_keys = OFF');
        this.dqlite.pragma('journal_mode = WAL');
        this.dqlite.pragma('synchronous = NORMAL');
        this.dqlite.pragma('cache_size = 4000');
        this.dqlite.pragma('temp_store = MEMORY');

        this.db = drizzle(this.dqlite, { schema });
        migrate(this.db, { migrationsFolder: this.migrationsPath });
    }

    private getInitedDB(): DrizzleDBType {
        if (!this.db) {
            throw new Error("项目数据库未初始化");
        }
        return this.db;
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    set(key: string, value: any): void {
        const db = this.getInitedDB();
        db.insert(schema.kvStore)
            .values({ key, value })
            .onConflictDoUpdate({
                target: schema.kvStore.key,
                set: { value },
            })
            .run();
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

    geUpdTime(key: string): string | null;
    geUpdTime(key: string[]): Record<string, string>;
    geUpdTime(key: string | string[]): string | null | Record<string, string> {
        const db = this.getInitedDB();

        if (Array.isArray(key)) {
            if (key.length === 0) return {};

            const results = db
                .select({
                    key: schema.kvStore.key,
                    updatedAt: schema.kvStore.updatedAt
                })
                .from(schema.kvStore)
                .where(inArray(schema.kvStore.key, key))
                .all();

            return results.reduce((acc, row) => {
                if (row.updatedAt) {
                    acc[row.key] = row.updatedAt;
                }
                return acc;
            }, {} as Record<string, string>);
        }

        const result = db
            .select({ updatedAt: schema.kvStore.updatedAt })
            .from(schema.kvStore)
            .where(eq(schema.kvStore.key, key))
            .get();

        return result?.updatedAt || null;
    }

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
                        throwNotfound(`没有id为"${id}"的能力。`)
                    }
                    return ""
                }
                if (content) {
                    return capa.code;
                }
                // eslint-disable-next-line @typescript-eslint/no-unused-vars
                const { updatedAt, createdAt, code, ...safeCapa } = capa;

                return JSON.stringify(safeCapa, null, 2);
            }
            case 'glossary':
                {
                    const value = this.get<string>(id);
                    if (value === null) {
                        if (!noThrow) {
                            throwNotfound(`没有key为"${id}"的术语。`)
                        }
                        return ""
                    }
                    if (content || id.startsWith('_')) {
                        return value;
                    }
                    return JSON.stringify(value, null, 2)
                }
            case 'metag':
                {
                    const value = this.getMetag(id)[0];
                    if (value === null) {
                        if (!noThrow) {
                            throwNotfound(`没有fieldKey为"${id}"的元术语。`)
                        }
                        return ""
                    }
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

    verifyContent(_setInfo: SetItem): string[] {
        throwNotimplement("尚未实现内容验证，自行小心。")
    }

    dispose(): void {
        this.forceClose();
    }
}