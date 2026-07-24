import { isCapability } from '$libs/blueprint/capability/is.js';
import { isMetagJson, metagFromJson } from '$libs/blueprint/metag/is.js';
import { PrjDB } from '$libs/project/controllers/drizzle/index.js';
import { IProjectContext } from '$libs/project/type.js';
import { app } from 'electron';
import Logger from 'electron-log/main.js';
import fg from 'fast-glob';
import { pathExists } from 'fs-extra';
import { mkdir, readFile, writeFile } from 'fs/promises';
import pMap from 'p-map';
import { basename, dirname, extname, join } from 'path';
import { getErrorMessage } from 'radashi';
import { fileURLToPath } from 'url';
import { throwUnprcessable } from './err.js';

/** 收集到的单个文件 */
interface CollectedFile {
    /** 相对 subDir 的相对路径（用于同名覆盖判定） */
    relativePath: string;
    /** 文件全路径（读文件、报异常时使用） */
    fullPath: string;
}

/** 文件类别：mg / capa(含 capa+code) / kv / other */
type Category = 'mg' | 'capa' | 'kv' | 'other';

/** 处理 other 类别的回调：拿到一批文件名，自行处理 */
type OtherFilesHandler = (files: CollectedFile[]) => Promise<void> | void;

const KnowlegeDirName = 'knowledge';
/**
 * 全局知识中心。支持从训练好的项目中导出知识，下次新建此类项目时，自动初始化其知识中心。
 * @todo: 项目隔离，是对逻辑向AI自学习能力信心不足，如果有稳定收敛判定机制，项目可以直接使用全局知识中心，无需每项隔离。
 */
class KnowledgeCenter {
    /** 可写扩展的知识中心根目录（对外暴露），优先级高，覆盖 resource 同名文件 */
    public readonly kcPath: string;
    /** 发行包自带的只读资源根目录，优先级低 */
    public readonly resourcePath: string;

    /** 读文件并发上限 */
    private readonly concurrency: number = 8;

    constructor() {
        this.kcPath = join(app.getPath('userData'), KnowlegeDirName);

        if (app.isPackaged) {
            // 生产环境：userData 下的 knowledge（可写扩展） + resources 下的 knowledge（只读初始）
            this.resourcePath = join(process.resourcesPath, KnowlegeDirName);
        } else {
            // 开发环境：直接指向源码目录，二者一致，方便动态更新
            // 当前文件位于 dist，向上一级到项目根目录
            const __dirname = dirname(fileURLToPath(import.meta.url));
            this.resourcePath = join(__dirname, '..', KnowlegeDirName);
        }
    }

    /**
     * 初始化某个子目录下的项目知识。
     *
     * 流程：
     * 1. 扫描 resourcePath/subDir 收集全部文件；
     * 2. 扫描 fullPath/subDir 收集全部文件，相同相对路径覆盖第 1 步的结果；
     * 3. 按后缀分为 mg / capa(+code) / kv / other 四类；
     * 4. 四类并行处理：前三类由知识中心内部处理，other 交给外部回调。
     *
     * @param subDir       子目录名
     * @param onOtherFiles other 类别（第四类）的处理回调
     */
    public async initProject(prj: IProjectContext, subDir: string, onOtherFiles?: OtherFilesHandler): Promise<void> {

        const files: CollectedFile[] = await this.collectFiles(subDir);

        // 分类
        const groups: Record<Category, CollectedFile[]> = { mg: [], capa: [], kv: [], other: [] };
        for (const file of files) {
            groups[this.categorize(file.fullPath)].push(file);
        }

        Logger.log(
            `[KnowledgeCenter] initProject "${subDir}"：mg=${groups.mg.length} ` +
            `capa=${groups.capa.length} kv=${groups.kv.length} other=${groups.other.length}`,
        );

        // 四类并行处理
        await Promise.all([
            this.processMg(prj, groups.mg),
            this.processCapa(prj, groups.capa),
            this.processKv(prj, groups.kv),
            onOtherFiles ? onOtherFiles(groups.other) : Promise.resolve(),
        ]);
    }

    /**
     * 写入文件到 kcPath 下。
     * - 目录不存在则自动创建（含多级）；
     * - 文件已存在则直接覆盖。
     *
     * @param subDir       子目录名
     * @param relativePath 相对 subDir 的相对路径（含文件名）
     * @param content      要写入的字符串内容
     */
    public async writeFile(subDir: string, relativePath: string, content: string): Promise<void> {
        const fullPath: string = join(this.kcPath, subDir, relativePath);
        await mkdir(dirname(fullPath), { recursive: true });
        await writeFile(fullPath, content, 'utf-8');
    }


    // 按照优先级次序，获取文件，返回全路径，如果文件不存在，则返回null.
    public async getFile(subDir: string, relativePath: string): Promise<string | null> {
        const fullPath: string = join(this.kcPath, subDir, relativePath);
        if (await pathExists(fullPath)) {
            return fullPath;
        }
        const resPath = join(this.resourcePath, subDir, relativePath);
        if (await pathExists(resPath)) {
            return resPath;
        }
        return null;
    }


    public async readJSON<T = unknown>(subDir: string, relativePath: string): Promise<T | null> {
        const filePath = await this.getFile(subDir, relativePath);
        if (!filePath) {
            return null;
        }
        try {
            const raw: string = await readFile(filePath, 'utf-8');
            return JSON.parse(raw) as T;
        } catch (error) {
            throwUnprcessable(
                `[KnowledgeCenter] JSON 解析失败: ${filePath}\n${getErrorMessage(error)}`,
            );
        }
    }

    // ────────────────────────── 收集 & 分类 ──────────────────────────

    /**
     * 扫描 resourcePath/subDir 与 fullPath/subDir，收集全部文件。
     * fullPath 中的文件覆盖 resourcePath 中相同相对路径的文件。
     */
    private async collectFiles(subDir: string): Promise<CollectedFile[]> {
        // relativePath -> fullPath；后写入的覆盖先写入的
        const merged = new Map<string, string>();

        // 顺序即优先级：resource 低，fullPath 高（后者覆盖前者）
        const roots: string[] = [join(this.resourcePath, subDir), join(this.kcPath, subDir)];

        for (const root of roots) {
            if (!(await pathExists(root))) {
                Logger.warn('[KnowledgeCenter] 目录不存在，跳过', root);
                continue;
            }

            const relatives: string[] = await fg('**/*', {
                cwd: root,
                onlyFiles: true,
                dot: true,
            });

            for (const relativePath of relatives) {
                merged.set(relativePath, join(root, relativePath));
            }
        }

        return [...merged.entries()].map(([relativePath, fullPath]) => ({ relativePath, fullPath }));
    }

    /** 按后缀判定类别 */
    private categorize(filePath: string): Category {
        switch (extname(filePath).toLowerCase()) {
            case '.mg':
                return 'mg';
            case '.capa':
            case '.code':
                return 'capa';
            case '.kv':
                return 'kv';
            default:
                return 'other';
        }
    }

    // ────────────────────────── 读文件工具 ──────────────────────────

    /** 以文本形式读取文件内容 */
    private async readText(file: CollectedFile): Promise<string> {
        return readFile(file.fullPath, 'utf-8');
    }

    /** 以 JSON 形式读取文件内容，解析失败抛出带全路径的异常 */
    private async internalReadJson<T = unknown>(file: CollectedFile): Promise<T> {
        try {
            const raw: string = await readFile(file.fullPath, 'utf-8');
            return JSON.parse(raw) as T;
        } catch (error) {
            throwUnprcessable(
                `[KnowledgeCenter] JSON 解析失败: ${file.fullPath}\n${(error instanceof Error ? error.message : String(error))}`,
            );
        }
    }

    // ────────────────────── 前三类处理（内部，架子） ──────────────────────
    /** 第一类：.mg —— 读文本 + JSON 解析 */
    private async processMg(prj: IProjectContext, files: CollectedFile[]): Promise<void> {
        const prjDB = PrjDB.ensure(prj);
        const upcertMetag = (data: unknown) => {
            let added = false;
            if (isMetagJson(data)) {
                const metag = metagFromJson(data);
                if (metag) {
                    prjDB.upcertMetag(metag);
                    added = true;
                }
            }
            if (!added) {
                Logger.warn(`忽略错误格式的元术语定义:${JSON.stringify(data, null, 2)}`)
            }
        }
        await pMap(
            files,
            async (file) => {
                const data = await this.internalReadJson(file);
                // TODO(自行实现): 处理解析后的 mg 数据（prj / data / file.relativePath / file.fullPath）
                if (Array.isArray(data)) {
                    data.forEach(d => {
                        upcertMetag(d)
                    })
                } else {
                    upcertMetag(data);
                }
            },
            { concurrency: this.concurrency },
        );
    }

    /** 第二类：.capa + .code —— capa 做 JSON 解析并关联同目录 ${id}.code；code 仅作附属内容按需加载 */
    private async processCapa(prj: IProjectContext, files: CollectedFile[]): Promise<void> {
        const prjDB = PrjDB.ensure(prj);
        // 先建立 .code 文件索引：相对路径 -> 文件（供 capa 按 ${id}.code 查找）
        const codeByRelPath = new Map<string, CollectedFile>();
        for (const file of files) {
            if (extname(file.fullPath).toLowerCase() === '.code') {
                codeByRelPath.set(file.relativePath, file);
            }
        }
        // 仅遍历 .capa；.code 不单独处理，作为 capa 的 code 属性按需加载
        const capaFiles = files.filter((f) => extname(f.fullPath).toLowerCase() === '.capa');
        await pMap(
            capaFiles,
            async (file) => {
                const data = await this.internalReadJson(file);
                if (!isCapability(data)) {
                    Logger.warn(`忽略错误格式的能力定义:${JSON.stringify(data, null, 2)}`);
                    return;
                }
                // 检查同目录下 ${data.id}.code 文件，存在则加载为字符串写入 data.code
                const codeRel = join(dirname(file.relativePath), `${data.id}.code`);
                const codeFile = codeByRelPath.get(codeRel);
                if (codeFile) {
                    data.code = await this.readText(codeFile);
                } else {
                    Logger.debug(`能力 ${data.id} (${data.name}) 无 code 文件，跳过 code 加载`);
                }
                prjDB.upcertCapa(data);
            },
            { concurrency: this.concurrency },
        );
    }

    private tryWriteJSON(key: string, value: string, prjDB: PrjDB) {
        try {
            const jsonVal = JSON.parse(value);
            prjDB.set(key, jsonVal);
        } catch (e) {
            Logger.warn(`读取${key}时，其值不是一个合法的JSON,当作字符串存入kv-store:${getErrorMessage(e)}`)
            prjDB.set(key, value);
        }
    }

    /** 第三类：.kv —— 文件名(去 .kv 后缀)为 key，文件内容为 value */
    private async processKv(prj: IProjectContext, files: CollectedFile[]): Promise<void> {
        const prjDB = PrjDB.ensure(prj);

        await pMap(
            files,
            async (file) => {
                const key = basename(file.fullPath, extname(file.fullPath));
                const value = await this.readText(file);
                if (key.startsWith("_") || key.startsWith("entry_")) {
                    // 明确是字符串类型的，直接写入。
                    prjDB.set(key, value);
                } else {
                    this.tryWriteJSON(key, value, prjDB);
                }
            },
            { concurrency: this.concurrency },
        );
    }
}

// 直接实例化并导出
export const knowledgeCenter = new KnowledgeCenter();