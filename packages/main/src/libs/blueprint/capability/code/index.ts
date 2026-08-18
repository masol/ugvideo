import { PrjDB } from "$libs/project/controllers/drizzle/index.js";
import { LanceDB } from "$libs/project/controllers/lance/index.js";
import type { IRunnerContext } from "$types/blueprint/context.js";
import Logger from "electron-log/main.js";
import vm from "node:vm";
import { getErrorMessage } from "radashi";
import { BaseFunctor } from "../base.js";
import { Capability } from "../is.js";
import { FIXED_PACKAGES } from "./fixedpkgs.js";
import { getFlow } from "./flow.js";
import { getGlossary } from "./glossary.js";
import { getLLMPkgs } from "./llm.js";

/**
 * 基于 vm 的可信代码运行环境。
 *
 * 设计要点：
 *  1. 构造时一次性把源码包装成「异步闭包 + with(ioc)」并预编译为 V8 Script，
 *     后续每次 run 只做纯函数执行，避免高频调用时重复编译。
 *  2. 通过 `with(ioc)` 让源码可以直接书写 `userService.xxx`，
 *     无需 `ioc.userService`，达到「ioc 作为 global」的效果。
 *  3. runInThisContext 与主进程共享原型链，instanceof / 私有方法均可正常使用。
 */
export class VmCapaFunctor extends BaseFunctor {
    /** 预编译好的脚本（构造时编译一次，反复执行） */
    private readonly script: vm.Script;

    /**
     * @param code 待执行的可信源码字符串（可直接使用 await 与 ioc 上的成员）
     * @param filename 调试用文件名，便于错误堆栈定位
     */
    constructor(
        readonly capa: Capability
    ) {
        super(capa)
        const filename = `codecap-${capa.id}.vm.js`
        // 包装成一个接收 ioc 的 async 函数：
        // - async  => 支持源码内部直接 await
        // - with   => 把 ioc 的属性抬升为源码里的自由变量（直接访问）
        //   注意：with 在严格模式下不可用，这里不要写 "use strict"
        const wrappedCode = `(async function (__ioc__) {
  with (__ioc__) {
${capa.code}
  }
})`;

        this.script = new vm.Script(wrappedCode, { filename });
    }

    async doTask(ctx: IRunnerContext): Promise<void> {
        // 1. 构造注入给源码的 ioc 对象（作为源码的“全局”作用域）
        const ioc: Record<string, unknown> = {
            ctx,
            db: PrjDB.ensure(ctx.prj),
            lance: LanceDB.ensure(ctx.prj),
            cap: this.capa,
            glossary: getGlossary(ctx),
            llm: getLLMPkgs(ctx),
            flow: getFlow(ctx),
            ...FIXED_PACKAGES
        };

        // 2. 取出预编译的异步函数外壳（与主进程共享上下文）
        const asyncFn = this.script.runInThisContext() as (
            ioc: Record<string, unknown>,
        ) => Promise<void>;

        try {
            // 3. 注入 ioc 并等待单次执行完毕
            await asyncFn(ioc);
        } catch (e) {
            Logger.error(`代码节点${this.capa.id}执行时报错:${getErrorMessage(e)}`)
            throw e;
        }
    }
}