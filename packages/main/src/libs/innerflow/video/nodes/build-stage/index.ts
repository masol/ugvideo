// nodes/build-stage/index.ts
import { checkExpiry } from "$libs/blueprint/glossary/expiry.js";
import type { IRunnerContext } from "$types/blueprint/context.js";
import pMap from "p-map";
import { buildSceneStage } from "./scene-stage-builder.js";
import { Storage } from "./storage.js";
import type { Beat, SceneStage } from "./types.js";

/**
 * build-stage 节点：把所有场景还原为"物理舞台 + 节拍时间线"。
 * 每个场景两 Pass（静态舞台 NL→safefmt / 节拍 NL→safefmt），
 * 场景间用 p-map 并发。空间信息全部自然语言，无坐标求解。
 */
export async function buildStage(ctx: IRunnerContext): Promise<void> {
    const store = new Storage(ctx);
    const sceneIds = store.sceneIds();

    if (!sceneIds.length) {
        ctx.info("[buildStage] 无场景，跳过");
        return;
    }

    await pMap(
        sceneIds,
        async (sceneId) => {
            await buildSceneStage(ctx, sceneId);
        },
        { concurrency: 3 },
    );

    ctx.info(`[buildStage] 全部场景舞台构建完成，共 ${sceneIds.length} 场`);

    // 总览（纯展示拼接，无坐标）
    await buildOverview(ctx);
}

/** 人类可读总览：环境 + 实体外观 + 开场布局 + 节拍摘要，无几何坐标 */
async function buildOverview(ctx: IRunnerContext): Promise<void> {
    const store = new Storage(ctx);
    const sceneIds = store.sceneIds();

    if (!checkExpiry(ctx, {
        inputKeys: sceneIds.map(id => store.stageKey(id)),
        outputKeys: "output:stage_overview",
    })) {
        ctx.info("[buildStage:overview] 总览仍新鲜，跳过");
        return;
    }

    const sections: string[] = [];

    for (const sceneId of sceneIds) {
        const stage = store.getStage(sceneId);
        const beats = store.getBeats(sceneId);
        if (!stage) continue;

        sections.push(renderSceneSection(sceneId, stage, beats ?? []));
    }

    const overview = sections.join("\n\n---\n\n");
    store.saveOverview(overview);
    ctx.info(`[buildStage:overview] 总览完成 ${overview.length}字`);
}

function renderSceneSection(
    sceneId: string,
    stage: SceneStage,
    beats: Beat[],
): string {
    const lines: string[] = [];

    lines.push(`# 场景 ${sceneId}`);
    lines.push("");
    lines.push(`## 环境`);
    lines.push(stage.world.environment);
    lines.push(`主光：${stage.world.key_light}`);
    lines.push("");

    lines.push(`## 实体`);
    for (const e of stage.entities) {
        lines.push(`- ${e.id}｜${e.kind}｜${e.label}`);
        lines.push(`  - 外观：${e.appearance}`);
        lines.push(`  - 对齐特征：${e.alignment_hint}`);
        if (e.scene_overrides) {
            lines.push(`  - 本场差异：${e.scene_overrides}`);
        }
    }
    lines.push("");

    lines.push(`## 开场布局`);
    lines.push(stage.spatial_layout);
    lines.push("");

    if (beats.length) {
        lines.push(`## 节拍时间线`);
        for (const b of beats) {
            const dur = b.duration_hint ? `｜${b.duration_hint}` : "";
            const mood = b.mood ? `｜${b.mood}` : "";
            lines.push(`### 节拍 ${b.index}${dur}${mood}`);
            lines.push(b.summary);
            if (b.staging) {
                lines.push(`- 站位变化：${b.staging}`);
            }
            for (const d of b.deltas) {
                const parts: string[] = [];
                if (d.action) parts.push(`动作：${d.action}`);
                if (d.dialogue) parts.push(`台词：${d.dialogue}`);
                if (d.moves_to) parts.push(`移动：${d.moves_to}`);
                if (d.new_facing) parts.push(`朝向：${d.new_facing}`);
                if (d.holds?.length) {
                    const hstr = d.holds
                        .map(h => `${h.object_id}${h.hand ? `(${h.hand})` : ""}`)
                        .join("、");
                    parts.push(`持有：${hstr}`);
                }
                if (d.appearance_change) parts.push(`状态：${d.appearance_change}`);
                if (d.mood) parts.push(`情绪：${d.mood}`);
                if (parts.length) {
                    lines.push(`- ${d.entity_id}：${parts.join("；")}`);
                }
            }
        }
    }

    return lines.join("\n");
}