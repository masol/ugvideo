// src/workflows/script-to-video/nodes/extract-entities.ts
import { getSmartModel } from "$libs/model/balancer/get-smart-model.js";
import { PrjDB } from "$libs/project/controllers/drizzle/index.js";
import type { IRunnerContext } from "$types/blueprint/context.js";
import { ModelTags } from "$types/shared/model.js";
import { generateText } from "ai";
import { ENTITY_EXTRACTOR_PROMPT } from "../prompts/entity-extractor.js";

/**
 * 节点 2：元素提取
 * 输入：state:scenes_nl
 * 输出：
 *   state:entities_raw_nl (自然语言)
 *   state:dialogues_nl (台词自然语言)
 */
export async function extractEntities(ctx: IRunnerContext): Promise<void> {
    const prjdb = PrjDB.ensure(ctx.prj);
    const scenes = prjdb.get<string>("state:scenes_nl");
    if (!scenes) {
        ctx.warn("[extractEntities] 无场景数据，跳过");
        return;
    }

    ctx.notify("阶段一·元素提取", "正在提取人物/道具/环境...");

    const model = getSmartModel({
        requiredAbilities: [ModelTags.Reasoning],
        minInctx: 32768,
    }, ctx);

    // 一次性提取（NL 输出，下游做归一）
    const { text: entities } = await generateText({
        model,
        system: ENTITY_EXTRACTOR_PROMPT.system,
        prompt: ENTITY_EXTRACTOR_PROMPT.user(scenes),
    });

    prjdb.set("state:entities_raw_nl", entities);

    const { text: dialogues } = await generateText({
        model,
        system: ENTITY_EXTRACTOR_PROMPT.dialogueSystem,
        prompt: ENTITY_EXTRACTOR_PROMPT.dialogueUser(scenes),
    });

    prjdb.set("state:dialogues_nl", dialogues);

    ctx.info(`[extractEntities] 完成，实体 ${entities.length} 字符，台词 ${dialogues.length} 字符`);
}