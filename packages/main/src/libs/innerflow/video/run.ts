// run.ts
import { PrjDB } from "$libs/project/controllers/drizzle/index.js";
import { throwPrecondition } from "$libs/utils/err.js";
import type { IRunnerContext } from "$types/blueprint/context.js";
import { alignEntities } from './nodes/align-entities/index.js';
import { assignRenderStrategies } from "./nodes/assign-render-strategies/index.js";
import { concatVideos } from "./nodes/concat-videos/index.js";
import { designCharacterAssets } from "./nodes/design-characters/index.js";
import { designShots } from './nodes/design-shots/index.js';
import { generateReferenceImages } from "./nodes/generate-reference-images/index.js";
import { parseScript } from "./nodes/parse-script/index.js";
import { planVideoSegments } from "./nodes/plan-video-segments/index.js";
import { renderImages } from "./nodes/render-images/index.js";
import { renderVideos } from "./nodes/render-videos/index.js";

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

    // 新增：把场景内连续分镜拼接为 ≤15s 视频段（默认一镜到底）
    await planVideoSegments(ctx);
    // 新增：渲染每个视频段（与参考图相同的拓扑并行 + 串行代际）
    await renderVideos(ctx);
    // 新增：按场景顺序拼接所有段，产出 ffmpeg 命令清单（仅打印不执行）
    await concatVideos(ctx);

    ctx.notify("完成", "剧本到视频全流程已跑完");
}