// nodes/align-entities/index.ts
import { checkExpiry } from "$libs/blueprint/glossary/expiry.js";
import type { IRunnerContext } from "$types/blueprint/context.js";
import pMap from "p-map";
import { alignAllScenes } from "./entity-aligner.js";
import { buildSceneStage } from "./scene-stage-builder.js";
import { Storage } from "./storage.js";
import type { GlobalEntity, SceneStage } from "./types.js";

/**
 * align-entities 节点：建立跨场景实体身份一致性。
 *
 * 编排：
 *   1) 按场景并发 buildSceneStage（Pass A+B+C 三 Pass）
 *   2) 按叙事顺序串行 alignAllScenes（Pass D：逐场景对齐 + 登记册反向审计 ReAct）
 *   3) 总览拼接
 */
export async function alignEntities(ctx: IRunnerContext): Promise<void> {
    const store = new Storage(ctx);
    const sceneIds = store.sceneIds();

    if (!sceneIds.length) {
        ctx.info("[alignEntities] 无场景，跳过");
        return;
    }

    await pMap(
        sceneIds,
        async (sceneId) => {
            await buildSceneStage(ctx, sceneId);
        },
        { concurrency: 8 },
    );

    ctx.info(`[alignEntities] A+B+C 完成，共 ${sceneIds.length} 场`);

    await alignAllScenes(ctx, sceneIds);

    ctx.info(`[alignEntities] D 对齐 + 审计完成`);

    await buildOverview(ctx);
}

async function buildOverview(ctx: IRunnerContext): Promise<void> {
    const store = new Storage(ctx);
    const sceneIds = store.sceneIds();

    if (!checkExpiry(ctx, {
        inputKeys: [
            ...sceneIds.flatMap(id => [
                store.stageKey(id),
                store.alignedTextKey(id),
                store.alignKey(id),
            ]),
        ],
        outputKeys: "output:stage_overview",
    })) {
        ctx.info("[alignEntities:overview] 总览仍新鲜，跳过");
        return;
    }

    const sections: string[] = [];

    for (const sceneId of sceneIds) {
        const stage = store.getStage(sceneId);
        const alignedText = store.getAlignedText(sceneId);
        if (!stage) continue;

        sections.push(renderSceneSection(sceneId, stage, alignedText ?? ""));
    }

    const entities = store.allGlobalEntities();
    if (entities.length) {
        sections.push(renderRegistry(entities));
    }

    const overview = sections.join("\n\n---\n\n");
    store.saveOverview(overview);

    ctx.info(`[alignEntities:overview] 总览完成 ${overview.length}字`);
    ctx.info(`[alignEntities:overview] 内容预览：\n${overview.slice(0, 800)}${overview.length > 800 ? "\n..." : ""}`);
}

function renderSceneSection(sceneId: string, stage: SceneStage, alignedText: string): string {
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
            const countLabel = e.count === 0 ? "群体" : e.count === 1 ? "个体" : `${e.count}个`;
            const humanoidLabel = e.kind === "character" ? (e.humanoid ? "类人" : "非类人") : "—";
            lines.push(`- ${e.name}｜${e.kind}｜${countLabel}｜${humanoidLabel}`);
            lines.push(`  - 外观：${e.appearance ?? "无"}`);
        }
    }
    lines.push("");

    lines.push(`## 开场站位`);
    lines.push(stage.spatial_layout ?? "无");
    lines.push("");

    if (alignedText) {
        lines.push(`## 名称对齐后原文`);
        lines.push(alignedText);
    }

    return lines.join("\n");
}

function renderRegistry(entities: GlobalEntity[]): string {
    const lines: string[] = [`# 全局实体登记册`];
    for (const e of entities) {
        const name = e.name || "（无名）";
        const countLabel = e.count === 0 ? "群体" : e.count === 1 ? "个体" : `${e.count}个`;
        const humanoidLabel = e.kind === "character" ? (e.humanoid ? "类人" : "非类人") : "—";
        lines.push(`## ${name}（${e.kind}｜${countLabel}｜${humanoidLabel}）`);
        lines.push(`首次外观：${e.appearance || "无"}`);
        const scenes = Array.isArray(e.scenes) ? e.scenes : [];
        lines.push(`出场场景：${scenes.length ? scenes.join("、") : "（无）"}`);
    }
    return lines.join("\n");
}