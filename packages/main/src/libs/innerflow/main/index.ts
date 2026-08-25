// run.ts
import type { IRunnerContext } from "$types/blueprint/context.js";
import Logger from "electron-log/main.js";

export async function run(ctx: IRunnerContext): Promise<void> {
    Logger.debug("response to cmd", ctx.cmd?.body)

    ctx.notify("完成", "助手完成主循环。");
}