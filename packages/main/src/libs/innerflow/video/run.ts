// run.ts
import { PrjDB } from "$libs/project/controllers/drizzle/index.js";
import { throwPrecondition } from "$libs/utils/err.js";
import type { IRunnerContext } from "$types/blueprint/context.js";
import { alignEntities } from './nodes/align-entities/index.js';
import { assignRenderStrategies } from "./nodes/assign-render-strategies/index.js";
import { designCharacterAssets } from "./nodes/design-characters/index.js";
import { designShots } from './nodes/design-shots/index.js';
import { generateReferenceImages } from "./nodes/generate-reference-images/index.js";
import { parseScript } from "./nodes/parse-script/index.js";
import { renderImages } from "./nodes/render-images/index.js";

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
    await renderImages(ctx);

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