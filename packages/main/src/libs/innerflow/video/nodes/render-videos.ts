// src/workflows/script-to-video/nodes/render-videos.ts
import { PrjDB } from "$libs/project/controllers/drizzle/index.js";
import type { IRunnerContext } from "$types/blueprint/context.js";

/**
 * 节点 12：图生视频渲染（Seedance / Veo3）
 *
 * 你需要接外部视频 API。
 *
 * 输入 KV：
 *   asset:Sxx-yy:start_url / asset:Sxx-yy:end_url
 *   state:motion_prompts_nl
 *
 * 写回 KV：
 *   output:Sxx-yy:video_url      — 分镜视频 URL
 *   output:Sxx-yy:duration_ms   — 时长（毫秒）
 *   output:Sxx-yy:audio_offset  — 在最终时间轴上的偏移
 */
export async function renderVideos(ctx: IRunnerContext): Promise<void> {
    const prjdb = PrjDB.ensure(ctx.prj);
    const motion = prjdb.get<string>("state:motion_prompts_nl");
    if (!motion) {
        ctx.warn("[renderVideos] 无运镜提示词，跳过");
        return;
    }

    ctx.notify("阶段四·视频渲染", "正在调用图生视频模型...");

    // ===== 由你实现 =====
    // 推荐：
    //   1) parse motion 文本，逐个分镜提取 (start_url, end_url, prompt, duration, motion params)
    //   2) 对每个分镜并发调用外部视频 API：
    //        - Seedance：支持多模态参考图 + native 多镜头（一致性较强）
    //        - Veo3.1：Ingredients-to-Video（资产一致性）
    //        - Kling / Runway：各有取舍
    //   3) 视频生成回来后，**建议立即做一次 VLM 自检**（人物是否还是同一人，结尾是否匹配 end frame）
    //      若不通过 → 回退到上一节点改写 motion prompt，再生成
    //   4) 把结果 URL + duration 写入 output:Sxx-yy:*
    //
    // 【素材一致性建议】
    //   - Seedance：把 entity base image 作为 character reference 传入
    //   - Veo3：Ingredients-to-Video 模式，预生成 3-5 张 reference（人物/道具/环境）
    //   - 锁定 seed / camera path 提升一致性

    void prjdb;
}