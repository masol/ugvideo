import type { EmbedingOp, EmbedType } from '$libs/model/factory/type.js';
import { throwNotfound, throwPrecondition } from '$libs/utils/err.js';
import type { Connection } from '@lancedb/lancedb';
import Logger from 'electron-log/main.js';
import { join } from 'node:path';
import { metaDirName, type IProjectContext } from '../../type.js';
import { BaseProjectController } from '../base.js';
import { PrjDB } from '../drizzle/index.js';
import { LanceEmbeding } from './embed.js';
import { getLanceDB, type LanceDBType } from './lancedb.js';
import { SkillRegistry } from './skillreg.js';
import { TableBase, TableConstructor } from './tablebase.js';
import { initAllTables } from './tables/index.js';
import { ILanceDB } from './type.js';

export const lanceDirName = "lance"

export class LanceDB extends BaseProjectController implements ILanceDB {
    static readonly serviceKey = Symbol.for('project.controller.LanceDB');

    #db: Connection | null = null;
    #lanceInst: LanceDBType | null = null;
    #embedInst: LanceEmbeding = new LanceEmbeding();
    #skills: SkillRegistry;
    #opened: boolean = false;

    // 这里保存的全部是单张表形式--因为从contructor为key。
    private registry = new Map<TableConstructor, TableBase>();

    constructor(ctx: IProjectContext) {
        super(ctx)
        this.#skills = new SkillRegistry(this);
    }

    async addTable<T extends TableBase>(token: TableConstructor<T>, name: string): Promise<void> {
        if (!this.#db) {
            throwPrecondition("LanceDB数据库未初始化，无法添加表。请先调用 open() 并确保向量模型已配置。");
        }
        const instance = new token(this, name);
        await instance.init(this.#db);
        this.registry.set(token, instance);
    }

    getTable<T extends TableBase>(token: TableConstructor<T>): T | null {
        const instance = this.registry.get(token);
        if (!instance) {
            return null;
        }
        return instance as T;
    }

    get skills(): SkillRegistry {
        return this.#skills;
    }

    get embedSize(): number {
        return this.#embedInst.embedSize;
    }

    get lanceInst(): LanceDBType {
        if (!this.#lanceInst) {
            throwPrecondition("LanceDB未初始化!")
        }
        return this.#lanceInst
    }

    async doEmbedding(batch: string[], type: EmbedType): Promise<number[][]> {
        return this.#embedInst.doEmbedding(batch, type);
    }

    static ensure(ctx: IProjectContext): LanceDB { return this.coreEnsure(this, ctx); }

    get opened(): boolean {
        return this.#opened && !!this.#db;
    }

    get db(): Connection {
        if (!this.#db) {
            throwNotfound(`未初始化的Lance数据库！`)
        }
        return this.#db;
    }

    get embed(): EmbedingOp {
        return this.#embedInst.embed;
    }

    get embedReady(): boolean {
        return this.#embedInst.ready;
    }

    private async initEmbed(): Promise<boolean> {
        const prjdb = PrjDB.ensure(this.ctx);
        await this.#embedInst.init(prjdb);
        return this.#embedInst.ready;
    }

    /**
     * 打开 LanceDB。
     *
     * 关键决策：
     *  - embed 不可用时（例如未配置向量模型）：LanceDB 整体不可用，
     *    标记 opened=false，但**不抛异常**。调用方通过 `embedReady` /
     *    `opened` 自行判断是否降级使用纯 KV 功能。
     *  - LanceDB 一旦初始化成功（embed 已就绪），`addTable` 即正常工作，
     *    不再要求后续每次都检查 embed 状态——表本身只是 schema，不依赖嵌入。
     */
    async open(): Promise<void> {
        if (this.#opened && this.#db) return;
        const lancePath = join(this.ctx.path, metaDirName, lanceDirName);

        try {
            this.#lanceInst = await getLanceDB();

            const embedReady = await this.initEmbed();
            if (!embedReady) {
                // 向量模型未配置或初始化失败：LanceDB 整体不可用，但不让项目打开失败
                Logger.warn('[LanceDB] 向量模型未就绪，LanceDB 与 RAG 功能将不可用，项目将以降级模式运行。');
                this.#opened = false;
                return;
            }

            this.#db = await this.lanceInst.connect(lancePath, {
                storageOptions: { timeout: '10s' }
            });
            await initAllTables(this);

            this.#opened = true;
            Logger.debug(`[LanceDB] 数据库已成功连接.`);
            return;
        } catch (error) {
            Logger.error('[LanceDB] 本地数据库连接失败:', error);
            this.#opened = false;
            // 不抛出异常，允许项目以无 LanceDB 模式打开
        }
    }

    close() {
        if (!this.#db) {
            Logger.info('[LanceDB] 数据库本就处于关闭状态.');
            return;
        }

        try {
            Logger.debug('[LanceDB] 正在安全释放资源并关闭连接...');

            for (const tableInstance of this.registry.values()) {
                tableInstance.close();
            }
            this.registry.clear();

            this.#db.close();
            this.#db = null;
            this.#opened = false;
            Logger.log('[LanceDB] 数据库连接已安全断开.');
        } catch (error) {
            Logger.error('[LanceDB] 关闭数据库时发生错误:', error);
        }
    }
};