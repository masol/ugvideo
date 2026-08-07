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

/**
 * 解析 target 字符串 "x/y"，返回用户选择停止的步骤序号（1-based）。
 * 非法值（null / 格式不对 / x > y）返回 Infinity，表示跑完全部步骤。
 */
function parseTargetStep(raw: string | null): number {
    if (!raw) return Infinity;
    const m = raw.match(/^(\d+)\/(\d+)$/);
    if (!m) return Infinity;
    const x = parseInt(m[1], 10);
    const y = parseInt(m[2], 10);
    if (x < 1 || x > y) return Infinity;
    return x;
}

export async function run(ctx: IRunnerContext): Promise<void> {
    const prjdb = PrjDB.ensure(ctx.prj);

    const script = prjdb.get<string>("script");
    if (!script) {
        throwPrecondition("[script-to-video] 缺少剧本输入 script");
    }

    // target = "x/y"，运行完第 x 步后停止；非此格式则跑完全部
    const targetStep = parseTargetStep(prjdb.get<string>("target"));

    ctx.notify("剧本到视频", "工作流启动");

    // Step 1：实体生成（解析场景 + 实体对齐）
    await parseScript(ctx);
    await alignEntities(ctx);
    if (targetStep <= 1) { ctx.notify("已停止", "实体生成完成"); return; }

    // Step 2：角色设计（身份推断 + 服装设计 + 制服设计）
    await designCharacterAssets(ctx);
    if (targetStep <= 2) { ctx.notify("已停止", "角色设计完成"); return; }

    // Step 3：分镜设计（意图抽取 + 光照设计 + 分镜序列 + 素材扩写）
    await designShots(ctx);
    if (targetStep <= 3) { ctx.notify("已停止", "分镜设计完成"); return; }

    // Step 4：渲染策略（按场景隔离的实体渲染决策）
    await assignRenderStrategies(ctx);
    if (targetStep <= 4) { ctx.notify("已停止", "渲染策略完成"); return; }

    // Step 5：参考图生成（定妆照/环境图/制服三视图/视频镜头提示词，均为提示词，不出图）
    await generateReferenceImages(ctx);
    if (targetStep <= 5) { ctx.notify("已停止", "参考图提示词生成完成"); return; }

    // Step 6：视频分段（把分镜按 ≤15s 打包为 Seedance segment）
    await planVideoSegments(ctx);
    if (targetStep <= 6) { ctx.notify("已停止", "视频分段完成"); return; }

    // Step 7：图片渲染（调图像生成 API 出定妆照/环境图/制服三视图）
    await renderImages(ctx);
    if (targetStep <= 7) { ctx.notify("已停止", "图片渲染完成"); return; }

    // Step 8：视频渲染（调视频生成 API 出各 segment 视频）
    await renderVideos(ctx);
    if (targetStep <= 8) { ctx.notify("已停止", "视频渲染完成"); return; }

    // Step 9：后期处理（打印 ffmpeg 拼接命令，产出 concat_plan）
    await concatVideos(ctx);

    ctx.notify("完成", "剧本到视频全流程已跑完");
}