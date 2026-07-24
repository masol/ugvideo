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

// @TODO: 实现项目类型接口，此处需要调用类型接口来创建和维护表格。当前为了简化，全部硬编码在此处。

export class LanceDB extends BaseProjectController implements ILanceDB {
    static readonly serviceKey = Symbol.for('project.controller.LanceDB');

    #db: Connection | null = null;
    #lanceInst: LanceDBType | null = null;
    #embedInst: LanceEmbeding = new LanceEmbeding();
    #skills: SkillRegistry

    // 这里保存的全部是单张表形式--因为从contructor为key。
    private registry = new Map<TableConstructor, TableBase>();

    constructor(ctx: IProjectContext) {
        super(ctx)
        this.#skills = new SkillRegistry(this);
    }

    async addTable<T extends TableBase>(token: TableConstructor<T>, name: string): Promise<void> {
        // 2. 自动实例化：利用统一的构造函数契约，在容器内部 new 出来
        const instance = new token(this, name);
        await instance.init(this.db);
        this.registry.set(token, instance);
    }

    getTable<T extends TableBase>(token: TableConstructor<T>): T | null {
        const instance = this.registry.get(token);
        if (!instance) {
            return null;
        }
        // 3. 内部唯一安全的断言，由于 register 和 resolve 泛型 T 严格绑定，此转换 100% 安全
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


    // 是否成功创建--是否提供了系统级的embed.
    get opened(): boolean {
        return !!this.#db;
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

    private async initEmbed() {
        const prjdb = PrjDB.ensure(this.ctx);
        return await this.#embedInst.init(prjdb);
    }

    // 打开数据库库，如果已经打开，直接返回。
    async open(): Promise<void> {
        if (this.#db) return;
        const lancePath = join(this.ctx.path, metaDirName, lanceDirName);

        try {
            this.#lanceInst = await getLanceDB();

            await this.initEmbed();

            this.#db = await this.lanceInst.connect(lancePath, {
                storageOptions: { timeout: '10s' }
            });
            await initAllTables(this);

            Logger.debug(`[LanceDB] 数据库已成功连接.`);
            return;
        } catch (error) {
            Logger.error('[LanceDB] 本地数据库连接失败:', error);
            throw error;
        }
    }


    /**
     * 安全关闭数据库方法
    */
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

            // 调用连接实例的关闭方法
            this.#db.close();

            this.#db = null; // 清空引用
            Logger.log('[LanceDB] 数据库连接已安全断开.');
        } catch (error) {
            Logger.error('[LanceDB] 关闭数据库时发生错误:', error);
            // throw error;
        }
    }
};