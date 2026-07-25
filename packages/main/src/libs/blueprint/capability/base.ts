
import { throwPrecondition } from "$libs/utils/err.js";
import type { Capability, NewCapability } from "$types/blueprint/capability.js";
import type { IRunnerContext } from "$types/blueprint/context.js";
import { fullInternalName, getInternalName } from "./is.js";
import type { ICapaFunctor } from "./type.js";

export function fillCapa(capa: NewCapability): Capability {
    const name = getInternalName(capa?.name) ?? capa?.name
    if (!name) {
        throwPrecondition("fillCapa只支持内存填充internal functor。")
    }
    const realName = fullInternalName(name);
    return {
        id: capa.id ?? crypto.randomUUID(),
        role: "",
        goal: '',
        code: "",
        input: [],
        output: [],
        process: '',
        negative: '',
        criteria: '',
        fewshot: [],
        createdAt: '',
        updatedAt: '',
        ...capa,
        name: realName
    }
}

export abstract class BaseFunctor implements ICapaFunctor {

    constructor(readonly capa: Capability) { }
    // 由run实现方主动调用基类的getInput/saveOutput方法来获取输入和保存输出。
    protected abstract doTask(ctx: IRunnerContext): Promise<void>;
    async run(ctx: IRunnerContext): Promise<void> {
        try {
            if (ctx.isAborted) {
                return;
            }
            ctx.push(this.capa)
            await this.doTask(ctx);
        } finally {
            ctx.pop();
        }
    }
}