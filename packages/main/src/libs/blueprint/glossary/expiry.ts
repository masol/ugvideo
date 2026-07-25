
import { PrjDB } from "$libs/project/controllers/drizzle/index.js";
import { getPrjTime, getPrjTimeFromArray } from "$libs/utils/db/prjstore.js";
import { IRunnerContext } from "$types/blueprint/context.js";
import type { PrjTimeStore } from "$types/prjstore.js";
import type { Dayjs } from "dayjs";

type StoreLike<T = unknown> = PrjTimeStore<T> | null;
type StoreInput<T = unknown> = StoreLike<T> | Array<StoreLike<T>> | null | undefined;

/**
 * 基座：基于已加载的 PrjTimeStore 判断输出是否过期(陈旧)。
 * 语义：
 *  - 无任何输入时间基准 -> 无法判断，视为"不过期"(false)，输入缺失由调用方处理。
 *  - 任一输出缺失/无时间 -> 过期(true)。
 *  - 最早输出时间 早于 最新输入时间 -> 过期。
 *  - 任一资源时间 晚于 最早输出时间 -> 过期(资源被视为输入的一部分)。
 *
 * 不读库、不读 metag，纯时间比对。用 readKey/getWithTime 拿到数据后可直接复用。
 */
export function isExpiredByTime(
    inputs: StoreInput,
    outputs: StoreInput,
    resources?: StoreInput
): boolean {
    const latestInput = latestTimeOf(inputs);
    if (!latestInput) {
        return false;
    }

    const earliestOutput = earliestTimeOf(outputs);
    if (!earliestOutput) {
        return true;    
    }

    if (earliestOutput.isBefore(latestInput)) {
        return true;
    }

    if (resources) {
        const latestRes = latestTimeOf(resources);
        if (latestRes && latestRes.isAfter(earliestOutput)) {
            return true;
        }
    }

    return false;
}

export type CheckExpiryArgs = {
    inputKeys: string | string[];
    outputKeys: string | string[];
    resourceKeys?: string | string[];
};

/**
 * 纯 key-based 过期判断(基座之上的便捷封装)。
 * 只按 key 读取时间戳，不读 metag、不校验 schema。
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

function latestTimeOf(v: StoreInput): Dayjs | null {
    if (v == null) return null;
    if (Array.isArray(v)) return getPrjTimeFromArray(v, true);
    return getPrjTime(v, true);
}

function earliestTimeOf(v: StoreInput): Dayjs | null {
    if (v == null) return null;
    if (Array.isArray(v)) return getPrjTimeFromArray(v, false);
    return getPrjTime(v, false);
}