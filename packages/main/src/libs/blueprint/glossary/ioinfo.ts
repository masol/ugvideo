/* eslint-disable @typescript-eslint/no-explicit-any */
import { PrjDB } from "$libs/project/controllers/drizzle/index.js";
import { getPrjTimeFromArray, stripPrjTimeArray } from "$libs/utils/db/prjstore.js";
import type { IRunnerContext } from "$types/blueprint/context.js";
import type { PrjTimeStore } from "$types/prjstore.js";
import dayjs from "dayjs";
import { Capability } from "../capability/is.js";
import { isExpiredByTime } from "./expiry.js";

export type IOInfo<IType = unknown, OType = unknown, RType = unknown> = {
    /** 输出是否过期(需要重算)。资源被视为输入的一部分参与判断。 */
    expired: boolean;
    inputs: Array<IType | null>;
    outputs: Array<OType | null>;
    resources: Array<RType | null>;
    inputsWithTime: Array<PrjTimeStore<IType> | null>;
    outputsWithTime: Array<PrjTimeStore<OType> | null>;
    resourcesWithTime: Array<PrjTimeStore<RType> | null>;
};

export type GetIOArgs = {
    inputs?: string | string[];
    outputs?: string | string[];
    /** 依赖资源：参与过期判断(等价于额外输入)，并原样读取返回。 */
    res?: string | string[];
};

function toKeys(k?: string | string[]): string[] {
    if (k == null) return [];
    return Array.isArray(k) ? k : [k];
}

/**
 * key-based 主入口：不依赖 capa，按 key 读取 IO + 资源并给出过期判断。
 * inputs/outputs/res 均可为单值或数组；返回值统一归一化为数组
 * (最佳实践：数组返回可预测，无联合/条件类型负担)。
 *
 * 通常一次调用即可拿到值 + expired。
 * 仅"数组内逐项失效"等特殊场景才需调用方自行再比对(基座见 isExpiredByTime)。
 */
export function getIOByKeys<IType = any, OType = any, RType = any>(
    ctx: IRunnerContext,
    args: GetIOArgs
): IOInfo<IType, OType, RType> {
    const prjdb: PrjDB = PrjDB.ensure(ctx.prj);

    const inKeys = toKeys(args.inputs);
    const outKeys = toKeys(args.outputs);
    const resKeys = toKeys(args.res);

    const inputsWithTime = inKeys.map((k) => prjdb.getWithTime<IType>(k));
    const outputsWithTime = outKeys.map((k) => prjdb.getWithTime<OType>(k));
    const resourcesWithTime = resKeys.map((k) => prjdb.getWithTime<RType>(k));

    const expired = isExpiredByTime(inputsWithTime, outputsWithTime, resourcesWithTime);

    return {
        expired,
        inputs: stripPrjTimeArray<IType>(inputsWithTime),
        outputs: stripPrjTimeArray<OType>(outputsWithTime),
        resources: stripPrjTimeArray<RType>(resourcesWithTime),
        inputsWithTime,
        outputsWithTime,
        resourcesWithTime,
    };
}

/**
 * capa 版本：以 capa.input/output 为默认 IO，委托给 getIOByKeys。
 * 额外语义：capa 自身若在输出之后更新(改了代码/目标)，同样视为过期。
 */
export function getIOInfo<IType = any, OType = any, RType = any>(
    ctx: IRunnerContext,
    capa: Capability,
    reses?: string[],
    inputKeys?: string[],
    outputKeys?: string[]
): IOInfo<IType, OType, RType> {
    const info = getIOByKeys<IType, OType, RType>(ctx, {
        inputs: inputKeys ?? capa.input,
        outputs: outputKeys ?? capa.output,
        res: reses,
    });

    if (!info.expired && capa.updatedAt && info.outputsWithTime.length > 0) {
        const earliestOutput = getPrjTimeFromArray(info.outputsWithTime, false);
        if (earliestOutput && dayjs(capa.updatedAt).isAfter(earliestOutput)) {
            return { ...info, expired: true };
        }
    }

    return info;
}