// src/workflows/script-to-video/nodes/build-motion-prompts.ts
import { getSmartModel } from "$libs/model/balancer/get-smart-model.js";
import { PrjDB } from "$libs/project/controllers/drizzle/index.js";
import type { IRunnerContext } from "$types/blueprint/context.js";
import { ModelTags } from "$types/shared/model.js";
import { generateText } from "ai";
import { MOTION_PROMPT_BUILDER_PROMPT } from "../prompts/motion-prompt-builder.js";

/**
 * 节点 11：动态与渲染参数控制
 * 输入：state:keyframes_polished_nl + state:storyboard_nl + state:layered_prompts_nl
 * 输出：state:motion_prompts_nl
 *
 * 输出用于图生视频模型的运镜 + 时间 + 提示词
 */
export async function buildMotionPrompts(ctx: IRunnerContext): Promise<void> {
    const prjdb = PrjDB.ensure(ctx.prj);
    const kf = prjdb.get<string>("state:keyframes_polished_nl") ?? "";
    const storyboard = prjdb.get<string>("state:storyboard_nl") ?? "";
    const layered = prjdb.get<string>("state:layered_prompts_nl") ?? "";

    if (!kf) return;

    ctx.notify("阶段四·运镜提示词", "正在生动态/特效描述...");

    const model = getSmartModel({
        requiredAbilities: [ModelTags.Outline, ModelTags.Reasoning],
        minInctx: 32768,
    }, ctx);

    const { text } = await generateText({
        model,
        system: MOTION_PROMPT_BUILDER_PROMPT.system,
        prompt: MOTION_PROMPT_BUILDER_PROMPT.user(kf, storyboard, layered),
    });

    prjdb.set("state:motion_prompts_nl", text);
    ctx.info(`[buildMotionPrompts] 完成`);
}