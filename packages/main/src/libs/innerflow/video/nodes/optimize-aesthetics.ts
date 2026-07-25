// src/workflows/script-to-video/nodes/optimize-aesthetics.ts
import { getSmartModel } from "$libs/model/balancer/get-smart-model.js";
import { PrjDB } from "$libs/project/controllers/drizzle/index.js";
import type { IRunnerContext } from "$types/blueprint/context.js";
import { ModelTags } from "$types/shared/model.js";
import { generateText } from "ai";
import { AESTHETIC_OPTIMIZER_PROMPT } from "../prompts/aesthetic-optimizer.js";

/**
 * 节点 7：美学构图优化
 * 输入：state:keyframes_nl
 * 输出：state:keyframes_polished_nl (润色后的首尾帧描述)
 */
export async function optimizeAesthetics(ctx: IRunnerContext): Promise<void> {
    const prjdb = PrjDB.ensure(ctx.prj);
    const kf = prjdb.get<string>("state:keyframes_nl");
    if (!kf) return;

    ctx.notify("阶段二·美学优化", "正在润色构图与光影...");

    const model = getSmartModel({
        requiredAbilities: [ModelTags.Writing, ModelTags.Reasoning],
        minInctx: 32768,
    }, ctx);

    const { text } = await generateText({
        model,
        system: AESTHETIC_OPTIMIZER_PROMPT.system,
        prompt: AESTHETIC_OPTIMIZER_PROMPT.user(kf),
    });

    prjdb.set("state:keyframes_polished_nl", text);
    ctx.info(`[optimizeAesthetics] 完成`);
}