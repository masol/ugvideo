import { getSmartModel } from "$libs/model/index.js";
import { NL2Format, safefmt } from "$libs/model/llm/outline.js";
import { prism, PrismOpts } from "$libs/model/llm/prism/prism.js";
import { LlmParamArgs } from "$types/ai/gentext.js";
import { IRunnerContext } from "$types/blueprint/context.js";
import { generateText, Output } from "ai";


// 透传ctx,以允许abort生效。
const generate = async (ctx: IRunnerContext, args: LlmParamArgs) => {
    const { model, ...rest } = args;


    const result = await generateText({
        model: getSmartModel(model, ctx),
        ...rest
    });
    return result;
}

const prsimaProxy = async (ctx: IRunnerContext, query: string, opts?: PrismOpts) => {
    const result = await prism(query, opts, ctx);
    return result;
}


// eslint-disable-next-line @typescript-eslint/no-explicit-any
const safefmProxy = async (ctx: IRunnerContext, nl: string, output: any) => {
    // Logger.debug("output=", output)
    const ret = await safefmt(nl, output, ctx);
    // Logger.debug("safefmt=", nl)
    // Logger.debug("ret=", ret.value)
    return ret;
}

const nl2fmt = async (ctx: IRunnerContext, args: LlmParamArgs) => {
    const { model, ...rest } = args;
    const result = await NL2Format({
        model: getSmartModel(model, ctx),
        ...rest
    });
    return result;
}

const fixed = {
    Output
}

export function getLLMPkgs(ctx: IRunnerContext) {
    return {
        ...fixed,
        generate: generate.bind(null, ctx),
        nL2Format: nl2fmt.bind(null, ctx),
        prism: prsimaProxy.bind(null, ctx),
        safefmt: safefmProxy.bind(null, ctx)
    } as const
};
