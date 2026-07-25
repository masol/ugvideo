// src/workflows/script-to-video/nodes/build-layered-prompts.ts
import { getSmartModel } from "$libs/model/balancer/get-smart-model.js";
import { PrjDB } from "$libs/project/controllers/drizzle/index.js";
import type { IRunnerContext } from "$types/blueprint/context.js";
import { ModelTags } from "$types/shared/model.js";
import { generateText } from "ai";
import { LAYERED_PROMPT_BUILDER_PROMPT } from "../prompts/layered-prompt-builder.js";

/**
 * 节点 8：分层提示词构建
 * 输入：state:keyframes_polished_nl + 实体基准描述 + state_log
 * 输出：state:layered_prompts_nl
 *   格式（每个分镜）：

### Sxx-yy
[CHARACTERS]
- C01 林夏: ... (canonical + 当前场景状态叠加)

[PROPS]
- P01 左轮手枪: ...

[ENVIRONMENT]
- L01 老旧公寓客厅: ...

[STYLE]
- 整体艺术风格 / 光照氛围 / 调色 / 镜头语言 ...

[FRAME]
- start_frame_prompt: "..."
- end_frame_prompt:   "..."
*/
export async function buildLayeredPrompts(ctx: IRunnerContext): Promise<void> {
    const prjdb = PrjDB.ensure(ctx.prj);
    const kf = prjdb.get<string>("state:keyframes_polished_nl") ?? "";
    const canonical = prjdb.get<string>("state:entity_canonical_nl") ?? "";
    const stateLog = prjdb.get<string>("state:state_log_nl") ?? "";

    if (!kf) return;

    ctx.notify("阶段三·分层提示词", "正在拆解人物/道具/环境/风格 prompt...");

    const model = getSmartModel({
        requiredAbilities: [ModelTags.Outline, ModelTags.Reasoning],
        minInctx: 49152,
    }, ctx);

    const { text } = await generateText({
        model,
        system: LAYERED_PROMPT_BUILDER_PROMPT.system,
        prompt: LAYERED_PROMPT_BUILDER_PROMPT.user(kf, canonical, stateLog),
    });

    prjdb.set("state:layered_prompts_nl", text);
    ctx.info(`[buildLayeredPrompts] 完成`);
}