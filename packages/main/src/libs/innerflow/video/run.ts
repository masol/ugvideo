// src/workflows/script-to-video/run.ts
import { PrjDB } from "$libs/project/controllers/drizzle/index.js";
import { throwPrecondition } from "$libs/utils/err.js";
import type { IRunnerContext } from "$types/blueprint/context.js";
import { alignEntities } from './nodes/align-entities/index.js';
import { designShots } from './nodes/design-shots/index.js';
import { generateReferenceImages } from "./nodes/generate-reference-images/index.js";
import { parseScript } from "./nodes/parse-script/index.js";

/**
 * 剧本 -> 视频 全自动工作流
 *
 * 阶段一：剧本解析与资产归一（顺序）
 * 阶段二：场景意图与分镜规划（顺序，依赖阶段一 KV）
 * 阶段三：资产图校验闭环（并发，按场景循环迭代）
 * 阶段四：动态视频与音频（并发）
 * 阶段五：FFmpeg 合成（顺序）
 */
export async function run(ctx: IRunnerContext): Promise<void> {
    const prjdb = PrjDB.ensure(ctx.prj);

    // ===== 校验入口输入 =====
    const script = prjdb.get<string>("script");
    if (!script) {
        throwPrecondition("[script-to-video] 缺少剧本输入 script");
    }

    ctx.notify("剧本到视频", "工作流启动");

    // ===== 阶段一：剧本解析 + 资产归一 =====
    await parseScript(ctx);
    await alignEntities(ctx);
    // ===== 阶段二：分镜设计 =====
    await designShots(ctx);

    // // ===== 阶段三：资产图 + VLM 闭环 =====
    await generateReferenceImages(ctx);
    // await generateBaseImages(ctx);
    // await vlmConsistencyEval(ctx);
    // // ===== 阶段四：动态视频 + 音频 =====
    // await buildMotionPrompts(ctx);
    // await Promise.all([
    //     renderVideos(ctx),
    //     synthesizeAudio(ctx),
    // ]);
    // // ===== 阶段五：合成导出 =====
    // await assembleFinal(ctx);

    ctx.notify("完成", "剧本到视频全流程已跑完");
}