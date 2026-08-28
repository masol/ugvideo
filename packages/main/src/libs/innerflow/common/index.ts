// run.ts
import { throwUnprcessable } from "$libs/utils/err.js";
import type { IRunnerContext } from "$types/blueprint/context.js";
import { createCommonContext } from "./context.js";
import { targetLoop } from "./targetloop.js";

export async function run(ctx: IRunnerContext): Promise<void> {
    // Logger.debug("response to cmd", ctx.cmd?.body)
    if (!ctx.cmd?.body) {
        throwUnprcessable("本次进入目标循环，但是未指定任意新的内容。")
    }

    const cctx = createCommonContext(ctx);
    await targetLoop.run(cctx);

    ctx.notify("完成", "助手完成主循环。");
}