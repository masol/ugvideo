// src/workflows/script-to-video/nodes/analyze-emotion.ts
import { getSmartModel } from "$libs/model/balancer/get-smart-model.js";
import { PrjDB } from "$libs/project/controllers/drizzle/index.js";
import type { IRunnerContext } from "$types/blueprint/context.js";
import { ModelTags } from "$types/shared/model.js";
import { generateText } from "ai";
// import { EMOTION_ANALYZER_PROMPT } from "../prompts/emotion-analyzer.js";

/**
 * 节点 4：情绪与意图分析
 * 输入：state:scenes_nl + state:state_log_nl + state:entity_register_nl
 * 输出：state:emotion_brief_nl (按场景逐个的情绪/意图简报)
 */
export async function analyzeEmotion(ctx: IRunnerContext): Promise<void> {
    const prjdb = PrjDB.ensure(ctx.prj);

    const scenes = prjdb.get<string>("state:scenes_nl") ?? "";
    // const stateLog = prjdb.get<string>("state:state_log_nl") ?? "";
    // const register = prjdb.get<string>("state:entity_register_nl") ?? "";
    // const dialogues = prjdb.get<string>("state:dialogues_nl") ?? "";

    if (!scenes) return;

    ctx.notify("阶段二·情绪分析", "正在分析场景情绪与剧情作用...");

    const model = getSmartModel({
        requiredAbilities: [ModelTags.Reasoning],
        minInctx: 32768,
    }, ctx);

    const { text } = await generateText({
        model,
        instructions: "", // EMOTION_ANALYZER_PROMPT.system,
        prompt: '', // EMOTION_ANALYZER_PROMPT.user(scenes, stateLog, dialogues, register),
    });

    prjdb.set("state:emotion_brief_nl", text);
    ctx.info(`[analyzeEmotion] 完成`);
}