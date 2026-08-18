/**
 * 维护 {@link https://openlineage.io | OpenLineage} 标准中的 DatasetFacets，
 * 主要侧重于数据时效性（即数据是否过期/新鲜度）的部分。并未实现其数据血缘维护的功能。(按照openlineage的定义，这是两个不同功能)
 * 这是一个快速实现的简化版--需在未来接入openlineage，支持完整功能--等到有Nodejs生态的库出现后接入 :-)
 *
 * @packageDocumentation
 *
 * 本文件将术语表中的辅助函数，专门封装为一个对象，供code cap使用。
 *
 * @remarks
 * 该模块致力于实现 OpenLineage 的 Dataset 特性。
 * 关于数据依赖关系（数据血缘）的跟踪：
 * - 考虑过使用高阶函数进行自动跟踪。
 * - 但这可能与 AI 的自动规划产生冲突。AI 在进行规划时，不应过度依赖历史的数据血缘信息，而应根据目标动态生成。
 *
 * @todo
 * 1. 完善当前数据时效性的验证逻辑。
 * 2. 未来引入逻辑库（如 swi-prolog）以支持无限递归方式的维度关系维护（当前版本不支持维度之间的逻辑一致性）。
 * 3. 规范化维度关系的自维护，避免过度依赖 LLM 直觉（这是产生幻觉和缺乏条理的根源）。
 */

import { getInput } from "$libs/blueprint/glossary/input.js";
import { PrjDB } from "$libs/project/controllers/drizzle/index.js";
import type { IRunnerContext } from "$types/blueprint/context.js";
import { isPlainObject } from "radashi";
import z, { ZodType } from "zod";
import { checkExpiry, isExpiredByTime } from "../../glossary/expiry.js";
import { getIOByKeys, getIOInfo } from "../../glossary/ioinfo.js";
import { saveToOutput } from "../../glossary/output.js";

const fixed = {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    validate: <T extends ZodType<any, any, any>>(schema: T,
        data: unknown
    ): z.infer<T> | null => {
        const result = schema.safeParse(data);
        if (result.success) {
            return result.data; // 校验成功，返回类型安全的类型对象
        }
        return null; // 校验失败，返回 null
    }
}

function getInputStr(ctx: IRunnerContext, name: string = "script"): string {
    const inptuArray = getInput(ctx, name);
    // Logger.error("inptuArray=", name, inptuArray)
    return inptuArray.join('\n\n\n');
}

export function getGlossary(ctx: IRunnerContext) {
    return {
        ...fixed,
        // capa 版本：以 capa.input/output 为默认 IO。
        getIO: getIOInfo.bind(null, ctx),
        // key-based 版本：不依赖 capa，直接按 key 读取 IO + 资源。
        getIOByKeys: getIOByKeys.bind(null, ctx),
        // 纯 key-based 过期判断。
        checkExpiry: checkExpiry.bind(null, ctx),
        getInput: getInputStr.bind(null, ctx),
        // 基座：基于已加载的 PrjTimeStore 判断过期(纯函数，无需 ctx)。
        isExpiredByTime,
        // 保存输出，支持内置 reducer 名或自定义 (older, newer) => merged 函数。
        save: saveToOutput.bind(null, ctx),
        set: (key: string, value: unknown, opt?: {
            reducer?: "merge" | "replace"
        }) => {
            const prjDB = PrjDB.ensure(ctx.prj);
            if (opt?.reducer === "merge") {
                const older = prjDB.get(key);
                if (older && isPlainObject(older) && isPlainObject(value)) {
                    prjDB.set(key, {
                        ...older,
                        ...value
                    })
                    return;
                }
            }
            PrjDB.ensure(ctx.prj).set(key, value);
        },
        get: <T = unknown>(key: string): T | null => {
            return PrjDB.ensure(ctx.prj).get<T>(key);
        }
    }
}