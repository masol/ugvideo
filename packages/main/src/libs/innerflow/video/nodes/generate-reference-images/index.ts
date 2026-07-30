// nodes/generate-reference-images/index.ts
import { checkExpiry } from "$libs/blueprint/glossary/expiry.js";
import type { IRunnerContext } from "$types/blueprint/context.js";
import pMap from "p-map";
import { generateSceneEnvironment } from "./environment-generator.js";
import {
    generateEntityRefsheet,
    generateGroupPhoto,
    generateUniformRefsheet,
} from "./refsheet-generator.js";
import { defaultRender } from "./render/default-renderer.js";
import { dispatchRenderTasks } from "./render/render-dispatcher.js";
import { generateSceneShotPrompts } from "./shot-prompt-generator.js";
import { RefImgStorage } from "./storage.js";
import type {
    EntityRefsheetPrompt,
    RenderResult,
    RenderTask,
    SceneEnvironmentPrompt,
    SceneShotPrompt,
} from "./types.js";

const MAX_CONCURRENT_RENDER = 12;

export async function generateReferenceImages(ctx: IRunnerContext): Promise<void> {
    const store = new RefImgStorage(ctx);
    const decisions = store.allRenderDecisions();

    if (!decisions.length) {
        ctx.info("[generateReferenceImages] 无实体决策，跳过");
        return;
    }

    const individualEntities = decisions
        .filter(d => d.strategy === "individual_refsheet")
        .map(d => d.name);

    const groupPhotoEntities = decisions
        .filter(d => d.strategy === "group_photo")
        .map(d => d.name);

    const uniforms = new Set<string>();
    for (const d of decisions) {
        if (d.strategy === "uniform_refsheet" && d.uniform_name) {
            uniforms.add(d.uniform_name);
        }
    }

    // Phase 1: 个体参考图（含 source_group 个体，大头+全身三视图）
    if (individualEntities.length > 0) {
        ctx.info(`[generateReferenceImages] 生成 ${individualEntities.length} 个实体参考图`);
        await pMap(individualEntities, name => generateEntityRefsheet(ctx, name), { concurrency: 4 });
    }

    // Phase 2: 制服三视图
    if (uniforms.size > 0) {
        ctx.info(`[generateReferenceImages] 生成 ${uniforms.size} 个制服三视图`);
        await pMap(Array.from(uniforms), name => generateUniformRefsheet(ctx, name), { concurrency: 2 });
    }

    // Phase 3: 群体合照（无制式服装的群体角色）
    if (groupPhotoEntities.length > 0) {
        ctx.info(`[generateReferenceImages] 生成 ${groupPhotoEntities.length} 个群体合照`);
        await pMap(groupPhotoEntities, name => generateGroupPhoto(ctx, name), { concurrency: 3 });
    }

    // Phase 4: 场景环境图
    const sceneIds = store.sceneIds();
    if (sceneIds.length > 0) {
        ctx.info(`[generateReferenceImages] 生成 ${sceneIds.length} 个场景环境图`);
        await pMap(sceneIds, id => generateSceneEnvironment(ctx, id), { concurrency: 3 });
    }

    // Phase 5: 渲染
    const refTasks = buildReferenceTasks(store);
    const eligibleTasks = applyImportanceCutoff(refTasks);

    if (eligibleTasks.length > 0) {
        ctx.info(`[generateReferenceImages] 渲染 ${eligibleTasks.length}/${refTasks.length} 个参考图/环境图（环境图全保留）`);
        await dispatchRenderTasks(ctx, eligibleTasks, defaultRender);
    }

    // Phase 6: 场景镜头提示词
    if (sceneIds.length > 0) {
        ctx.info(`[generateReferenceImages] 生成逐场景镜头提示词`);
        await pMap(sceneIds, id => generateSceneShotPrompts(ctx, id), { concurrency: 3 });
    }

    await buildOverview(ctx);
}

function buildReferenceTasks(store: RefImgStorage): RenderTask[] {
    const tasks: RenderTask[] = [];

    for (const name of store.generatedEntityNames()) {
        const prompt = store.getEntityRefsheet(name);
        if (!prompt) continue;
        const asset = store.getEntityAsset(name);
        const taskType = prompt.layout === "group_photo" ? "group_photo" : "entity_refsheet";
        tasks.push({
            id: name,
            type: taskType,
            prompt: prompt.prompt,
            importance: prompt.importance,
            referenced_shot_count: prompt.referenced_shot_count,
            referenced_scene_count: prompt.referenced_scene_count,
            asset_info: asset ? {
                entity_name: name,
                kind: asset.kind,
                layout: prompt.layout,
                humanoid: prompt.humanoid,
                base_description: asset.base_description,
            } : undefined,
            group_info: taskType === "group_photo" ? { group_entity_name: name } : undefined,
        });
    }

    for (const uniformName of store.uniformPromptIdx()) {
        const prompt = store.getUniformPrompt(uniformName);
        if (!prompt) continue;
        tasks.push({
            id: uniformName,
            type: "uniform_turnaround",
            prompt: prompt.prompt,
            importance: prompt.importance,
            referenced_shot_count: prompt.referenced_shot_count,
            referenced_scene_count: prompt.referenced_scene_count,
            uniform_info: {
                uniform_name: uniformName,
                group_entity_name: store.getUniform(uniformName)?.group_entity_name ?? "",
                wearer_gender: store.getUniform(uniformName)?.wearer_gender ?? "androgynous",
            },
        });
    }

    for (const sceneId of store.generatedSceneIds()) {
        const env = store.getSceneEnvironment(sceneId);
        if (!env) continue;
        const stage = store.getStage(sceneId);
        const lighting = store.getLighting(sceneId);
        tasks.push({
            id: sceneId,
            type: "scene_environment",
            prompt: env.prompt,
            importance: env.importance,
            referenced_shot_count: env.referenced_shot_count,
            referenced_scene_count: env.referenced_scene_count,
            scene_info: stage && lighting ? {
                scene_id: sceneId,
                environment: stage.world.environment,
                lighting_summary: lighting.summary,
                inline_entities: env.inline_entities,
            } : undefined,
        });
    }

    return tasks;
}

function applyImportanceCutoff(tasks: RenderTask[]): RenderTask[] {
    const envTasks = tasks.filter(t => t.type === "scene_environment");
    const otherTasks = tasks.filter(t => t.type !== "scene_environment");

    const remainingSlots = Math.max(0, MAX_CONCURRENT_RENDER - envTasks.length);

    const sortedOthers = [...otherTasks].sort((a, b) => {
        const aShot = a.referenced_shot_count ?? 0;
        const bShot = b.referenced_shot_count ?? 0;
        if (aShot !== bShot) return bShot - aShot;

        const aScene = a.referenced_scene_count ?? 0;
        const bScene = b.referenced_scene_count ?? 0;
        if (aScene !== bScene) return bScene - aScene;

        return b.importance - a.importance;
    });

    return [...envTasks, ...sortedOthers.slice(0, remainingSlots)];
}

async function buildOverview(ctx: IRunnerContext): Promise<void> {
    const store = new RefImgStorage(ctx);

    const entityNames = store.generatedEntityNames();
    const uniformNames = store.uniformPromptIdx();
    const sceneIds = store.generatedSceneIds();

    if (!checkExpiry(ctx, {
        inputKeys: [
            ...entityNames.map(n => store.entityRefsheetKey(n)),
            ...uniformNames.map(n => store.uniformPromptKey(n)),
            ...sceneIds.map(id => store.sceneEnvironmentKey(id)),
            ...sceneIds.map(id => store.shotPromptIdxKey(id)),
        ],
        outputKeys: store.overviewKey(),
    })) {
        ctx.info("[generateReferenceImages:overview] 总览仍新鲜，跳过");
        return;
    }

    const sections: string[] = [];

    if (entityNames.length) {
        sections.push("# 全局实体参考图（纯白背景）");
        for (const name of entityNames) {
            const prompt = store.getEntityRefsheet(name);
            const result = store.getRenderResult(name);
            if (prompt) sections.push(renderEntitySection(name, prompt, result));
        }
    }

    if (uniformNames.length) {
        sections.push("# 制服三视图");
        for (const name of uniformNames) {
            const prompt = store.getUniformPrompt(name);
            const result = store.getRenderResult(name);
            if (prompt) sections.push(renderEntitySection(name, prompt, result));
        }
    }

    if (sceneIds.length) {
        sections.push("# 场景环境图（无人物）");
        for (const sceneId of sceneIds) {
            const env = store.getSceneEnvironment(sceneId);
            const result = store.getRenderResult(sceneId);
            if (env) sections.push(renderSceneEnvSection(sceneId, env, result));
        }
    }

    sections.push("# 场景镜头提示词（按场景按镜头）");
    for (const sceneId of store.sceneIds()) {
        const shots = store.getSceneShotPrompts(sceneId);
        if (!shots.length) continue;
        sections.push(`## 场景 ${sceneId}（${shots.length} 镜）`);
        for (const shot of shots) {
            sections.push(renderShotSection(shot));
        }
    }

    const overview = sections.join("\n\n---\n\n");
    store.saveOverview(overview);
    ctx.info(`[generateReferenceImages:overview] 总览完成 ${overview.length}字`);
}

function renderEntitySection(
    name: string,
    prompt: EntityRefsheetPrompt,
    result: RenderResult | null,
): string {
    const layoutLabel = {
        four_column: "16:9 四列（左侧大头 + 右侧全身正/左45/背）",
        three_column: "16:9 三列（正/侧/背）",
        magazine_grid: "16:9 杂志网格",
        uniform_turnaround: "16:9 制服三视图",
        group_photo: "16:9 群体合照（自然站位）",
    }[prompt.layout];

    const srcGroupLabel = prompt.source_group ? `｜提升自群体：${prompt.source_group}` : "";

    return [
        `## ${name}（${prompt.kind}${prompt.humanoid ? "·类人" : ""}${srcGroupLabel}）`,
        `布局：${layoutLabel}｜重要度：${prompt.importance}｜跨镜头：${prompt.referenced_shot_count}｜跨场景：${prompt.referenced_scene_count}`,
        result?.file_path ? `渲染结果：${result.file_path}` : `渲染结果：（未渲染）`,
        ``,
        `### 参考图提示词（纯白背景）`,
        prompt.prompt,
    ].join("\n");
}

function renderSceneEnvSection(
    sceneId: string,
    env: SceneEnvironmentPrompt,
    result: RenderResult | null,
): string {
    return [
        `## 场景 ${sceneId} 环境图`,
        `现实参照：${env.real_world_references.join("、") || "（无）"}`,
        `含参考图的陈设/道具：${env.refsheet_entities.join("、") || "（无）"}`,
        `内联描述的陈设：${env.inline_entities.map(e => e.name).join("、") || "（无）"}`,
        `排除的动态道具：${env.excluded_dynamic_props.join("、") || "（无）"}`,
        `评审轮次：${env.review_round}（${env.review_history.map(r => r.verdict).join(" → ")}）`,
        result?.file_path ? `渲染结果：${result.file_path}` : `渲染结果：（未渲染）`,
        ``,
        `### 最终环境提示词`,
        env.prompt,
    ].join("\n");
}

function renderShotSection(shot: SceneShotPrompt): string {
    const refList = shot.reference_images.map(r => `${r.entity_name}(${r.role})`).join("、");
    return [
        `### 镜头 ${shot.shot_index}｜${shot.shot_meta.shot_type}｜${shot.shot_meta.camera_movement}｜${shot.shot_meta.duration_estimate}`,
        `引用参考图：${refList || "（无）"}`,
        ``,
        shot.prompt,
    ].join("\n");
}