// src/workflows/script-to-video/run.ts
import { PrjDB } from "$libs/project/controllers/drizzle/index.js";
import { throwPrecondition } from "$libs/utils/err.js";
import type { IRunnerContext } from "$types/blueprint/context.js";
import { alignEntities } from './nodes/align-entities/index.js';
import { assignRenderStrategies } from "./nodes/assign-render-strategies/index.js";
import { designCharacterAssets } from "./nodes/design-characters/index.js";
import { designShots } from './nodes/design-shots/index.js';
import { generateReferenceImages } from "./nodes/generate-reference-images/index.js";
import { parseScript } from "./nodes/parse-script/index.js";

/**
 * 剧本 -> 视频 全自动工作流
 *
 * pipeline:
 *   parseScript → alignEntities → designCharacterAssets（身份+服装+制服）
 *     → designShots（分镜+光照+素材扩写，render decision 此时默认 prompt_only）
 *     → assignRenderStrategies（基于分镜数据判定渲染策略）
 *     → generateReferenceImages（依赖分镜 + render decision）
 */
export async function run(ctx: IRunnerContext): Promise<void> {
    const prjdb = PrjDB.ensure(ctx.prj);

    const script = prjdb.get<string>("script");
    if (!script) {
        throwPrecondition("[script-to-video] 缺少剧本输入 script");
    }

    ctx.notify("剧本到视频", "工作流启动");

    await parseScript(ctx);
    await alignEntities(ctx);

    await designCharacterAssets(ctx);
    await designShots(ctx);

    await assignRenderStrategies(ctx);
    await generateReferenceImages(ctx);

    // await generateBaseImages(ctx);
    // await vlmConsistencyEval(ctx);
    // await buildMotionPrompts(ctx);
    // await Promise.all([
    //     renderVideos(ctx),
    //     synthesizeAudio(ctx),
    // ]);
    // await assembleFinal(ctx);

    ctx.notify("完成", "剧本到视频全流程已跑完");
}