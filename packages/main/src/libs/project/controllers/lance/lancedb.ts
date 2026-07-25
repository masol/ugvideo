import { app } from 'electron';
import { join } from 'node:path';

export type LanceDBType = Awaited<typeof import("@lancedb/lancedb")>;

const KEY = Symbol.for('unigen.singleton.lanceDB');

export async function getLanceDB(): Promise<LanceDBType> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const g = globalThis as any;
    if (g[KEY]) return g[KEY] as LanceDBType;
    const modelRoot = join(app.getPath("userData"), "lance-models");
    process.env.LANCE_LANGUAGE_MODEL_HOME = modelRoot;

    // 【第2步：复制词典文件】
    // 源：resources/jieba/default
    //   const sourceDictDir = path.join(process.resourcesPath, "jieba", "default");
    //   // 目标：{modelRoot}/jieba/default
    //   const targetDictDir = path.join(modelRoot, "jieba", "default");

    //   // 递归复制词典文件夹
    //   if (!(await fsExtra.pathExists(targetDictDir))) {
    //     if (await fsExtra.pathExists(sourceDictDir)) {
    //       await fsExtra.copy(sourceDictDir, targetDictDir, {
    //         recursive: true,
    //         overwrite: false,
    //       });
    //     } else {
    //       console.error("词典缺失：jieba/default 不存在");
    //     }
    //   }
    const db = await import('@lancedb/lancedb');
    g[KEY] = db;
    return db;
}