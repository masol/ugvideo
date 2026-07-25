// src/workflows/script-to-video/nodes/synthesize-audio.ts
import { PrjDB } from "$libs/project/controllers/drizzle/index.js";
import type { IRunnerContext } from "$types/blueprint/context.js";

/**
 * 节点 13：音频元素合成
 *   - TTS 台词配音
 *   - 环境音效
 *   - BGM
 *
 * 输入 KV：
 *   state:dialogues_nl        — 台词
 *   state:emotion_brief_nl    — 情绪（用于 BGM 风格 & 语速）
 *   state:storyboard_nl       — 分镜时长（用于音频时序）
 *
 * 写回 KV：
 *   output:Sxx-yy:tts_url
 *   output:Sxx-yy:sfx_url
 *   output:s01:bgm_url
 *   output:s01:bgm_duck_segments   — [{start,end,db}]
 */
export async function synthesizeAudio(ctx: IRunnerContext): Promise<void> {
    const prjdb = PrjDB.ensure(ctx.prj);
    void (prjdb)
    ctx.notify("阶段四·音频合成", "正在合成 TTS / 音效 / BGM...");
}