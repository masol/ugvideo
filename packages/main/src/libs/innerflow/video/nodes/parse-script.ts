// src/workflows/script-to-video/nodes/parse-script.ts
import { getSmartModel } from "$libs/model/balancer/get-smart-model.js";
import { PrjDB } from "$libs/project/controllers/drizzle/index.js";
import type { IRunnerContext } from "$types/blueprint/context.js";
import { generateText } from "ai";
import { SCENE_PARSER_PROMPT } from "../prompts/scene-parser.js";

/**
 * 节点 1：场景拆解
 * 输入：input:raw_script
 * 输出：state:scenes_nl (自然语言，以空行分隔)
 */
export async function parseScript(ctx: IRunnerContext): Promise<void> {
    const prjdb = PrjDB.ensure(ctx.prj);
    const script = prjdb.get<string>("input:raw_script");

    ctx.notify("阶段一·场景拆解", "正在拆解剧本...");

    const model = getSmartModel(undefined, ctx);

    const { text } = await generateText({
        model,
        system: SCENE_PARSER_PROMPT.system,
        prompt: SCENE_PARSER_PROMPT.user(script!),
    });

    prjdb.set("state:scenes_nl", text);

    const sceneCount = text.split(/\n{2,}/).filter(s => s.trim()).length;
    ctx.info(`[parseScript] 拆出 ${sceneCount} 个场景，文本 ${text.length} 字符`);
}