// src/workflows/script-to-video/nodes/plan-keyframes.ts
import { getSmartModel } from "$libs/model/balancer/get-smart-model.js";
import { PrjDB } from "$libs/project/controllers/drizzle/index.js";
import type { IRunnerContext } from "$types/blueprint/context.js";
import { ModelTags } from "$types/shared/model.js";
import { generateText } from "ai";
import { KEYFRAME_PLANNER_PROMPT } from "../prompts/keyframe-planner.js";

/**
 * 节点 6：首尾帧画面规划
 * 输入：state:storyboard_nl + entity canonical + state_log
 * 输出：state:keyframes_nl (每个分镜的首帧/尾帧画面描述)
 */
export async function planKeyframes(ctx: IRunnerContext): Promise<void> {
    const prjdb = PrjDB.ensure(ctx.prj);
    const storyboard = prjdb.get<string>("state:storyboard_nl") ?? "";
    const canonical = prjdb.get<string>("state:entity_canonical_nl") ?? "";
    const stateLog = prjdb.get<string>("state:state_log_nl") ?? "";

    if (!storyboard) return;

    ctx.notify("阶段二·首尾帧规划", "正在规划 Start/End Frame...");

    const model = getSmartModel({
        requiredAbilities: [ModelTags.Reasoning, ModelTags.Outline],
        minInctx: 49152,
    }, ctx);

    const { text } = await generateText({
        model,
        system: KEYFRAME_PLANNER_PROMPT.system,
        prompt: KEYFRAME_PLANNER_PROMPT.user(storyboard, canonical, stateLog),
    });

    prjdb.set("state:keyframes_nl", text);
    ctx.info(`[planKeyframes] 完成`);
}