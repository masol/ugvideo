import { PrjDB } from "$libs/project/controllers/drizzle/index.js";
import { throwNotimplement } from "$libs/utils/err.js";
import { IRunnerContext } from "$types/blueprint/context.js";
import { isPlainObject } from "radashi";
import { isIdentifiedItem } from "../blackboard/array.js";

export type ReducerFn = (older: unknown, newer: unknown) => unknown;

/**
 * 内置 reducer 策略。
 *  - replace    : 直接覆盖(调用方走此策略时可省去一次读，少读少开销)。
 *  - merge      : 浅合并两个普通对象；否则以新值为准。
 *  - append     : 向旧数组尾部追加；newer 非数组时按单元素追加；旧值非数组时直接以新值为结果。
 *  - prepend    : 向旧数组头部插入；规则同 append。
 *  - upsertById : 针对"带 ID 的数组"(见 isIdentifiedItem)按 id 增量合并。
 *       older 为带 id 对象数组；newer 可为单个带 id 对象或其数组。
 *       逐个新值按 id 在 older 中查找：命中则整体覆盖该项，未命中则追加。
 *       无 id 的新项无法定位，直接跳过。
 */
export const Reducers = {
    replace: (_older: unknown, newer: unknown) => newer,

    merge: (older: unknown, newer: unknown) => {
        if (isPlainObject(older) && isPlainObject(newer)) {
            return { ...older, ...newer };
        }
        return newer;
    },

    append: (older: unknown, newer: unknown) => {
        if (!Array.isArray(older)) {
            return newer;
        }
        return Array.isArray(newer) ? [...older, ...newer] : [...older, newer];
    },

    prepend: (older: unknown, newer: unknown) => {
        if (!Array.isArray(older)) {
            return newer;
        }
        return Array.isArray(newer) ? [...newer, ...older] : [newer, ...older];
    },

    upsertById: (older: unknown, newer: unknown) => {
        const incoming = Array.isArray(newer) ? newer : [newer];
        const base: unknown[] = Array.isArray(older) ? [...older] : [];
        for (const item of incoming) {
            if (!isIdentifiedItem(item)) {
                continue;
            }
            const idx = base.findIndex((o) => isIdentifiedItem(o) && o.id === item.id);
            if (idx >= 0) {
                base[idx] = item;
            } else {
                base.push(item);
            }
        }
        return base;
    },
} satisfies Record<string, ReducerFn>;

export type ReducerName = keyof typeof Reducers;

/**
 * 保存数据到指定输出 key。
 * reducer 可传内置策略名，或自定义 (older, newer) => merged 函数。
 * 默认 replace：直接覆盖，省去读取。
 */
export function saveToOutput(
    ctx: IRunnerContext,
    outputKey: string,
    value: unknown,
    reducer: ReducerName | ReducerFn = 'merge'
): boolean {
    const prjDB: PrjDB = PrjDB.ensure(ctx.prj);

    const output = prjDB.getMetag(outputKey)[0];
    if (!output) {
        ctx.error(`请求保存时，未能找到元术语定义:${outputKey}`);
        return false;
    }

    const key = output.fieldKey;
    if (!key) {
        ctx.error(`请求保存时，元术语定义${outputKey}中，无法获取存储key。`);
        return false;
    }

    // schema 校验：写入时验证，读取时信任
    if (output.schema && value !== null && value !== undefined) {
        const parseResult = output.schema.safeParse(value);
        if (!parseResult.success) {
            ctx.error(`Failed to parse IOdata for ${key}. Error: ${parseResult.error}`);
            return false;
        }
    }

    // replace 快路径：无需读旧值
    if (reducer === 'replace') {
        prjDB.set(key, value);
        return true;
    }

    const reducerFn: ReducerFn = typeof reducer === 'string' ? Reducers[reducer] : reducer;
    if (!reducerFn) {
        throwNotimplement(`尚未实现 reducer 策略:${reducer}。`);
    }

    const older = prjDB.get(key);
    prjDB.set(key, reducerFn(older, value));
    return true;
}