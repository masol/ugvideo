import { type ProjectType, projectTypeSchema } from '$types/shared/template/prjtype.js';
import { app } from 'electron';
import Logger from 'electron-log/main.js';
import fg from 'fast-glob';
import { pathExists } from 'fs-extra';
import { readFile } from 'fs/promises';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const DataDirName = 'data';
const TplMetasDirName = 'plugins';

/**
 * 全局数据中心。优先读取 userData/data 下的可写文件，
 * 不存在时回退到发行包自带的 resources/data 只读资源。
 */
class DataCenter {
    /** 可写扩展的数据目录（对外暴露），优先级高，覆盖 resource 同名文件 */
    public readonly dataPath: string;
    /** 发行包自带的只读资源根目录，优先级低 */
    public readonly resourcePath: string;

    /** 模板元信息缓存，null 表示尚未加载 */
    private tplMetas: ProjectType[] | null = null;

    constructor() {
        this.dataPath = join(app.getPath('userData'), DataDirName);

        if (app.isPackaged) {
            // 生产环境：resources 下的 data（只读初始）
            this.resourcePath = join(process.resourcesPath, DataDirName);
        } else {
            // 开发环境：直接指向源码目录，二者一致，方便动态更新
            // 当前文件位于 dist，向上一级到项目根目录
            const __dirname = dirname(fileURLToPath(import.meta.url));
            this.resourcePath = join(__dirname, '..', DataDirName);
        }
    }

    public findType(type: string): ProjectType | null {
        if (!type) return null;
        return this.tplMetas?.find(tpl => tpl.id == type) || null;
    }

    public typePath(...args: string[]): string {
        return join(this.dataPath, TplMetasDirName, ...args);
    }

    /**
     * 以文本形式读取 data 目录下的文件。
     * - 优先读取 userData/data 下的同名文件；
     * - 不存在时回退到 resources/data；
     * - 任何异常（文件不存在、读取失败等）均返回 null，不抛异常。
     *
     * @param relativePath 相对 data 目录的相对路径（含文件名）
     * @returns 文件文本内容，读取失败返回 null
     */
    public async readFile(...args: string[]): Promise<string | null> {
        // 顺序即优先级：userData 高，resource 低
        const candidates: string[] = [
            join(this.dataPath, ...args),
            join(this.resourcePath, ...args),
        ];

        for (const fullPath of candidates) {
            try {
                if (!(await pathExists(fullPath))) {
                    continue;
                }
                return await readFile(fullPath, 'utf-8');
            } catch (error) {
                Logger.warn('[DataCenter] 读取失败，跳过', fullPath, error);
            }
        }

        return null;
    }

    /**
     * 加载 data/plugins 目录下的全部 .json 模板元信息（ProjectType）。
     *
     * 流程：
     * 1. 扫描 resourcePath/plugins 与 dataPath/plugins 下的 .json 文件；
     * 2. 解析为 JSON，并用 zod 校验为 ProjectType，不合法则报警废弃；
     * 3. 以 id 去重，dataPath 覆盖 resourcePath（后者优先级低）；
     *    同一目录内 id 重复则报警并随机（后扫描到的）覆盖。
     *
     * @param bForce 为 false 且缓存有效时直接返回缓存；为 true 强制重新加载
     * @returns 去重后的 ProjectType 数组
     */
    public async loadTplMetas(bForce: boolean = false): Promise<ProjectType[]> {
        if (!bForce && this.tplMetas !== null) {
            return this.tplMetas;
        }

        // id -> { meta, root }；后写入的覆盖先写入的
        const merged = new Map<string, { meta: ProjectType; root: string }>();

        // 顺序即优先级：resource 低，dataPath 高（后者覆盖前者）
        const roots: string[] = [
            join(this.resourcePath, TplMetasDirName),
            join(this.dataPath, TplMetasDirName),
        ];

        for (const root of roots) {
            if (!(await pathExists(root))) {
                Logger.warn('[DataCenter] 模板目录不存在，跳过', root);
                continue;
            }

            const relatives: string[] = await fg('**/*.json', {
                cwd: root,
                onlyFiles: true,
                dot: true,
            });

            for (const relativePath of relatives) {
                const fullPath = join(root, relativePath);
                let raw: unknown;
                try {
                    raw = JSON.parse(await readFile(fullPath, 'utf-8'));
                } catch (error) {
                    Logger.warn('[DataCenter] 模板读取或解析失败，废弃', fullPath, error);
                    continue;
                }

                const parsed = projectTypeSchema.safeParse(raw);
                if (!parsed.success) {
                    Logger.warn('[DataCenter] 模板格式非法，废弃', fullPath, parsed.error.issues);
                    continue;
                }
                const meta = parsed.data;

                // 同一 root 内 id 重复：报警并随机（后扫描到的）覆盖
                const existing = merged.get(meta.id);
                if (existing && existing.root === root) {
                    Logger.warn(`[DataCenter] 同目录下模板 id 重复，随机覆盖: id=${meta.id}`, fullPath);
                }

                merged.set(meta.id, { meta, root });
            }
        }

        this.tplMetas = [...merged.values()].map(({ meta }) => meta);

        Logger.log(`[DataCenter] loadTplMetas：共加载 ${this.tplMetas.length} 个模板`);

        return this.tplMetas;
    }
}


const KEY = Symbol.for('unigen.singleton.dataCenter');
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const dataCenter: DataCenter = ((globalThis as any)[KEY] ??= new DataCenter());
