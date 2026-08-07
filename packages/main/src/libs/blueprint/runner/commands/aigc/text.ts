import { getSmartModel } from "$libs/model/index.js";
import type { IRunnerContext } from "$types/blueprint/context.js";
import { generateText } from "ai";


export async function textAIGC(ctx: IRunnerContext): Promise<void> {
    const body = ctx.cmd.body?.trim() ?? "";

    const reuslt = await generateText({
        model: getSmartModel(undefined, ctx),
        prompt: body
    })
    ctx.notify("", reuslt.text);
}
