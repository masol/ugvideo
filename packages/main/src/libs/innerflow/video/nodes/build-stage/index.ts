// nodes/build-stage/index.ts
import { checkExpiry } from "$libs/blueprint/glossary/expiry.js";
import type { IRunnerContext } from "$types/blueprint/context.js";
import pMap from "p-map";
import { alignScene } from "./entity-aligner.js";
import { buildSceneStage } from "./scene-stage-builder.js";
import { Storage } from "./storage.js";
import type { Beat, GlobalEntity, SceneStage } from "./types.js";

/**
 * build-stage 节点：把所有场景还原为忠实抽取的舞台 + 节拍时间线。
 *
 * 编排：
 *   1) 按场景并发 buildSceneStage（A+B）
 *   2) 按叙事顺序串行 alignScene（D，建全局登记册 + 对齐映射）
 *   3) 总览拼接（人类可读）
 *
 * 抽取产物保持纯净；跨场景身份由 alignScene 写在独立 KV 中。
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

    ctx.info(`[buildStage] A+B 完成，共 ${sceneIds.length} 场`);

    // 对齐必须串行（登记册是增长的），但单场景独立时效门控
    for (const sceneId of sceneIds) {
        await alignScene(ctx, sceneId);
    }

    ctx.info(`[buildStage] D 对齐完成`);

    await buildOverview(ctx);
}

/** 人类可读总览：环境 + 实体外观 + 开场站位 + 节拍摘要，null 一律显示「无」 */
async function buildOverview(ctx: IRunnerContext): Promise<void> {
    const store = new Storage(ctx);
    const sceneIds = store.sceneIds();

    if (!checkExpiry(ctx, {
        inputKeys: [
            ...sceneIds.flatMap(id => [store.stageKey(id), store.beatsKey(id), store.alignKey(id)]),
        ],
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

    // 追加全局登记册摘要
    const entities = store.allGlobalEntities();
    if (entities.length) {
        sections.push(renderRegistry(entities));
    }

    const overview = sections.join("\n\n---\n\n");
    store.saveOverview(overview);
    ctx.info(`[buildStage:overview] 总览完成 ${overview.length}字`);
}

function renderSceneSection(sceneId: string, stage: SceneStage, beats: Beat[]): string {
    const lines: string[] = [];

    lines.push(`# 场景 ${sceneId}`);
    lines.push("");
    lines.push(`## 环境`);
    lines.push(stage.world.environment);
    lines.push(`光线：${stage.world.key_light ?? "无"}`);
    lines.push("");

    lines.push(`## 实体`);
    if (stage.entities.length === 0) {
        lines.push("（无）");
    } else {
        for (const e of stage.entities) {
            lines.push(`- ${e.name}｜${e.kind}`);
            lines.push(`  - 外观：${e.appearance ?? "无"}`);
        }
    }
    lines.push("");

    lines.push(`## 开场站位`);
    lines.push(stage.spatial_layout ?? "无");
    lines.push("");

    if (beats.length) {
        lines.push(`## 节拍时间线`);
        for (const b of beats) {
            const dur = b.duration_hint ? `｜${b.duration_hint}` : "";
            const mood = b.mood ? `｜${b.mood}` : "";
            lines.push(`### 节拍 ${b.index}${dur}${mood}`);
            lines.push(b.summary);
            if (b.staging) lines.push(`- 站位变化：${b.staging}`);
            for (const d of b.deltas) {
                const parts: string[] = [];
                if (d.action) parts.push(`动作：${d.action}`);
                if (d.dialogue) parts.push(`台词：${d.dialogue}`);
                if (d.state_change) parts.push(`状态：${d.state_change}`);
                if (d.emotion) parts.push(`情绪：${d.emotion}`);
                if (parts.length) {
                    lines.push(`- ${d.entity}：${parts.join("；")}`);
                } else {
                    lines.push(`- ${d.entity}：（无变化）`);
                }
            }
        }
    }

    return lines.join("\n");
}

function renderRegistry(entities: GlobalEntity[]): string {
    const lines: string[] = [`# 全局实体登记册`];
    for (const e of entities) {
        lines.push(`## ${e.name}（${e.kind}）`);
        lines.push(`首次外观：${e.appearance || "无"}`);
        lines.push(`出场场景：${e.scenes.join("、")}`);
    }
    return lines.join("\n");
}