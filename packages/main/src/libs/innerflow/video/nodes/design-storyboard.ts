// src/workflows/script-to-video/nodes/design-storyboard.ts
import { getSmartModel } from "$libs/model/balancer/get-smart-model.js";
import { PrjDB } from "$libs/project/controllers/drizzle/index.js";
import type { IRunnerContext } from "$types/blueprint/context.js";
import { ModelTags } from "$types/shared/model.js";
import { generateText } from "ai";
import { STORYBOARD_DESIGNER_PROMPT } from "../prompts/storyboard-designer.js";

/**
 * 节点 5：分镜与表现手法设计
 * 输入：
 *   state:scenes_nl
 *   state:emotion_brief_nl
 *   state:state_log_nl
 * 输出：
 *   state:storyboard_nl (按场景分的分镜，自然语言，空行分隔)
 */
export async function designStoryboard(ctx: IRunnerContext): Promise<void> {
    const prjdb = PrjDB.ensure(ctx.prj);
    const scenes = prjdb.get<string>("state:scenes_nl") ?? "";
    const emotion = prjdb.get<string>("state:emotion_brief_nl") ?? "";
    const stateLog = prjdb.get<string>("state:state_log_nl") ?? "";

    if (!scenes) return;

    ctx.notify("阶段二·分镜设计", "正在规划镜头语言...");

    const model = getSmartModel({
        requiredAbilities: [ModelTags.Reasoning],
        minInctx: 49152,
    }, ctx);

    const { text } = await generateText({
        model,
        system: STORYBOARD_DESIGNER_PROMPT.system,
        prompt: STORYBOARD_DESIGNER_PROMPT.user(scenes, emotion, stateLog),
    });

    prjdb.set("state:storyboard_nl", text);
    ctx.info(`[designStoryboard] 完成`);
}