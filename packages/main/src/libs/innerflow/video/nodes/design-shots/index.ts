// nodes/design-shots/index.ts
import { checkExpiry } from "$libs/blueprint/glossary/expiry.js";
import type { IRunnerContext } from "$types/blueprint/context.js";
import pMap from "p-map";
import { designScene, initAssetConstraints } from "./shot-designer.js";
import { ShotStorage } from "./storage.js";
import type { EntityAsset, SceneLighting } from "./types.js";

/**
 * design-shots 节点：分镜序列 + 场景光照 + 逐实体素材扩写。
 */
export async function designShots(ctx: IRunnerContext): Promise<void> {
    const store = new ShotStorage(ctx);
    const sceneIds = store.sceneIds();

    if (!sceneIds.length) {
        ctx.info("[designShots] 无场景，跳过");
        return;
    }

    initAssetConstraints(ctx);
    ctx.info(`[designShots] 约束初始化完成，开始逐场景设计 ${sceneIds.length} 场`);

    await pMap(
        sceneIds,
        async (sceneId) => {
            await designScene(ctx, sceneId);
        },
        { concurrency: 4 },
    );

    ctx.info(`[designShots] 全部场景设计完成`);
    await buildOverview(ctx);
}

async function buildOverview(ctx: IRunnerContext): Promise<void> {
    const store = new ShotStorage(ctx);
    const sceneIds = store.designedSceneIds();

    if (!checkExpiry(ctx, {
        inputKeys: [
            store.assetConstraintsKey(),
            ...sceneIds.flatMap(id => [
                store.designKey(id),
                store.lightingKey(id),
            ]),
        ],
        outputKeys: store.overviewKey(),
    })) {
        ctx.info("[designShots:overview] 总览仍新鲜，跳过");
        return;
    }

    const sections: string[] = [];

    const style = store.getGlobalStyle();
    sections.push([
        `# 全局视觉准则（配置项）`,
        `画幅：${style.aspect_ratio}`,
        `节奏：${style.pacing}`,
        `风格：${style.style}`,
        `受众：${style.audience}`,
        `色调：${style.color_tone}`,
        `运镜：${style.camera_movement}`,
    ].join("\n"));

    const constraints = store.getAssetConstraints();
    if (constraints.length) {
        const lines = constraints.map(c => `- ${c.entity_name}（来源：${c.source_scene}）：${c.visual_description}`);
        sections.push(`# 素材全局约束\n${lines.join("\n")}`);
    }

    for (const sceneId of sceneIds) {
        sections.push(renderScene(store, sceneId));
    }

    const overview = sections.join("\n\n---\n\n");
    store.saveOverview(overview);
    ctx.info(`[designShots:overview] 总览完成 ${overview.length}字`);
}

function renderScene(store: ShotStorage, sceneId: string): string {
    const lines: string[] = [`# 场景 ${sceneId}`];

    const lighting = store.getLighting(sceneId);
    if (lighting) {
        lines.push(`## 光照`);
        lines.push(renderLighting(lighting));
    }

    const design = store.getDesign(sceneId);
    if (design) {
        lines.push("");
        lines.push(design);
    }

    const assets = store.getSceneAssets(sceneId);
    if (assets.length) {
        lines.push("");
        lines.push(`## 素材`);
        for (const a of assets) {
            lines.push(renderAsset(a));
        }
    }

    return lines.join("\n");
}

function renderLighting(l: SceneLighting): string {
    return [
        `- 主光方向：${l.key_light_direction}`,
        `- 主光色温：${l.key_light_color}`,
        `- 补光：${l.fill_light}`,
        `- 环境氛围：${l.ambient}`,
        `- 整体效果：${l.summary}`,
    ].join("\n");
}

function renderAsset(a: EntityAsset): string {
    const lines: string[] = [`### ${a.entity_name}（${a.kind}｜${a.importance}）`];
    lines.push(`- 基础：${a.base_description}`);
    if (a.scene_delta) lines.push(`- 本场变化：${a.scene_delta}`);
    lines.push(`- 光影：${a.lighting_effect}`);
    return lines.join("\n");
}