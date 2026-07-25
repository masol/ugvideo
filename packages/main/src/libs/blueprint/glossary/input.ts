import { PrjDB } from "$libs/project/controllers/drizzle/index.js";
import type { IRunnerContext } from "$types/blueprint/context.js";
import type { PrjTimeStore } from "$types/prjstore.js";
import { MetagRow } from "../metag/is.js";


/**
 * 读取 IO 数据。
 * 不再做 flatten 展开——这是上层职责。
 * 不做 schema 验证——写入时已验。
 */
export function getIOData<T = unknown>(ctx: IRunnerContext, i: MetagRow): PrjTimeStore<T> | null {
    const prjDB = PrjDB.ensure(ctx.prj);
    const key = i.fieldKey;
    if (key) return prjDB.getWithTime<T>(key);
    return null;
}