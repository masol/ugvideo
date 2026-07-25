// src/workflows/script-to-video/nodes/generate-base-images.ts
import { PrjDB } from "$libs/project/controllers/drizzle/index.js";
import type { IRunnerContext } from "$types/blueprint/context.js";

/**
 * 节点 9：生成实体基准图 / 首尾帧草图
 *
 * 你需要在这里接入实际图像生成：
 *   - SDXL / Flux：生成实体基准图（每个 canonical entity 出 1 张）
 *   - SDXL / Flux / Midjourney：生成每个分镜的 Start Frame / End Frame 草图
 *
 * 入参可读 KV：
 *   state:layered_prompts_nl   — 分层提示词（全分镜）
 *   entity:C01:description     — 实体基准描述（也可直接用 Image ref）
 *
 * 写回 KV 约定：
 *   asset:C01:base_image_url   — 林夏基准图 URL
 *   asset:P01:base_image_url   — 左轮手枪基准图 URL
 *   asset:S01-01:start_url     — 分镜首帧图 URL
 *   asset:S01-01:end_url       — 分镜尾帧图 URL
 *   ...（键名由你定，只要下游能读）
 *
 * 【素材一致性建议】
 *   - 实体基准图固定 seed + 固定 prompt + 高 LoRA 权重
 *   - 分镜首尾帧用 IP-Adapter / Reference-only 把 entity base 锁进去
 *   - 强烈建议人物和道具先生成 3 视图 / 九宫格一致性图作为锚点
 */
export async function generateBaseImages(ctx: IRunnerContext): Promise<void> {
    const prjdb = PrjDB.ensure(ctx.prj);
    ctx.notify("阶段三·生成基准图", "等待外部图像生成接入...");

    // ===== 由你实现 =====
    // 推荐流程：
    //   1) 读 state:layered_prompts_nl，遍历每个 canonical entity
    //   2) 调 SDXL/Flux → 保存 base image → 写回 asset:<id>:base_image_url
    //   3) 调 SDXL/Flux + IP-Adapter（用 base image 作为 char ref）
    //      → 生成每个分镜 start / end frame 草图
    //      → 写回 asset:Sxx-yy:start_url / asset:Sxx-yy:end_url
    //
    // 你可以直接调你项目里的 generateImage() 之类的封装。

    void prjdb;
}