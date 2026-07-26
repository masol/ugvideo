import { PrjDB } from "$libs/project/controllers/drizzle/index.js";
import type { IRunnerContext } from "$types/blueprint/context.js";
import type { IdentifiedItem } from "$types/index.js";
import type { PrjTimeStore } from "$types/prjstore.js";
import { isString } from "radashi";
import { isIdentifiedArray } from "../blackboard/array.js";
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


/**
 * 获取用户录入的原始数据，默认为script.
 * @param ctx 
 * @param name 
 * @returns 
 */

export function getInput(ctx: IRunnerContext, name: string = "script"): string[] {
    const prjdb: PrjDB = PrjDB.ensure(ctx.prj);
    const scriptArray: string[] = [];

    const inputs = prjdb.get<IdentifiedItem[]>(name);
    if (!isIdentifiedArray(inputs)) {
        return scriptArray;
    }

    inputs.forEach((item) => {
        const key = `script_${item.id}`
        const s = prjdb.get<string>(key);
        if (isString(s)) {
            scriptArray.push(s);
        }
    })
    return scriptArray;
}

