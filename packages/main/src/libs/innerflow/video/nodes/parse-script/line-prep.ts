// src/workflows/script-to-video/nodes/parse-script/line-prep.ts
import { PrjDB } from "$libs/project/controllers/drizzle/index.js";
import type { IRunnerContext } from "$types/blueprint/context.js";

/**
 * 把原始剧本拆为 string[]。
 * lines[i] = 第 i+1 行的内容（1-based 行号）。
 *
 * 保留空行（空行可能用于格式识别）。
 * 行号信息由数组下标承担，不再单独存 IndexedLine 对象。
 */
export function prepareLines(ctx: IRunnerContext): string[] {
    const prjdb = PrjDB.ensure(ctx.prj);
    const raw = prjdb.get<string>("input:raw_script");
    if (!raw) {
        throw new Error("[line-prep] input:raw_script 缺失");
    }

    const lines = raw.split(/\n/);
    ctx.info(`[line-prep] 总行数 ${lines.length}`);
    return lines;
}