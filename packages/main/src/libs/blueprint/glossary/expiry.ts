import { PrjDB } from "$libs/project/controllers/drizzle/index.js";
import { getPrjTime, getPrjTimeFromArray } from "$libs/utils/db/prjstore.js";
import { IRunnerContext } from "$types/blueprint/context.js";
import type { PrjTimeStore } from "$types/prjstore.js";
import type { Dayjs } from "dayjs";

type StoreLike<T = unknown> = PrjTimeStore<T> | null;
type StoreInput<T = unknown> = StoreLike<T> | Array<StoreLike<T>> | null | undefined;

/**
 * 基座：基于已加载的 PrjTimeStore 判断输出是否过期(陈旧)。
 * 语义(按判定顺序)：
 *  1. 输出列表为空、或任一输出缺失(null)/无时间 -> 过期(true)。输出缺失必须重算，与输入无关。
 *  2. 输入/资源中的 null 项直接忽略(视为该输入不存在)。
 *  3. 忽略后无任何输入时间基准 -> 无法判断，视为"不过期"(false)。
 *  4. 最早输出时间 早于 最新输入(含资源)时间 -> 过期。
 *
 * 不读库、不读 metag，纯时间比对。用 readKey/getWithTime 拿到数据后可直接复用。
 */
export function isExpiredByTime(
    inputs: StoreInput,
    outputs: StoreInput,
    resources?: StoreInput
): boolean {
    // 1) 任一输出缺失/无时间 -> 过期，优先级最高
    const outputList = toArray(outputs);
    if (outputList.length === 0) {
        return true;
    }

    let earliestOutput: Dayjs | null = null;
    for (const o of outputList) {
        if (o == null) {
            return true;
        }
        const t = getPrjTime(o, false);
        if (!t) {
            return true;
        }
        if (!earliestOutput || t.isBefore(earliestOutput)) {
            earliestOutput = t;
        }
    }

    // 2) 输入与资源等价，null 项忽略
    const validInputs = [...toArray(inputs), ...toArray(resources)]
        .filter((i): i is PrjTimeStore<unknown> => i != null);

    // 3) 无任何有效输入时间基准 -> 无法判断，视为不过期
    const latestInput = validInputs.length > 0
        ? getPrjTimeFromArray(validInputs, true)
        : null;
    if (!latestInput) {
        return false;
    }

    // 4) 输出早于输入 -> 过期
    return earliestOutput!.isBefore(latestInput);
}

export type CheckExpiryArgs = {
    inputKeys: string | string[];
    outputKeys: string | string[];
    resourceKeys?: string | string[];
};

/**
 * 纯 key-based 过期判断(基座之上的便捷封装)。
 * 只按 key 读取时间戳，不读 metag、不校验 schema。
 * 输入 key 对应数据缺失 -> 忽略该项；输出 key 对应数据缺失 -> 过期。
 */
export function checkExpiry(ctx: IRunnerContext, args: CheckExpiryArgs): boolean {
    const prjdb = PrjDB.ensure(ctx.prj);
    const load = (k?: string | string[]): Array<StoreLike> => {
        if (k == null) return [];
        return (Array.isArray(k) ? k : [k]).map((x) => prjdb.getWithTime(x));
    };

    return isExpiredByTime(
        load(args.inputKeys),
        load(args.outputKeys),
        args.resourceKeys ? load(args.resourceKeys) : undefined
    );
}

// ---------- internal ----------

function toArray(v: StoreInput): Array<StoreLike> {
    if (v == null) return [];
    return Array.isArray(v) ? v : [v];
}