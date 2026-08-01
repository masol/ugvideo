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
import { generateSceneShotPrompts } from "./shot-prompt-generator.js";
import { RefImgStorage } from "./storage.js";
import type {
    EntityRefsheetPrompt,
    RenderTaskDescriptor,
    SceneEnvironmentPrompt,
    SceneShotPrompt,
} from "./types.js";

const MAX_CONCURRENT_RENDER = 12;

export async function generateReferenceImages(ctx: IRunnerContext): Promise<void> {
    const store = new RefImgStorage(ctx);
    const allDecisions = store.allRenderDecisions();

    if (!allDecisions.length) {
        ctx.info("[generateReferenceImages] 无实体决策，跳过");
        return;
    }

    const individualPairs: Array<{ sceneId: string; name: string }> = [];
    const groupPhotoPairs: Array<{ sceneId: string; name: string }> = [];
    const uniforms = new Set<string>();

    for (const d of allDecisions) {
        const sid = d.scene_id ?? "unknown";
        if (d.strategy === "individual_refsheet") {
            individualPairs.push({ sceneId: sid, name: d.name });
        } else if (d.strategy === "group_photo") {
            groupPhotoPairs.push({ sceneId: sid, name: d.name });
        } else if (d.strategy === "uniform_refsheet" && d.uniform_name) {
            uniforms.add(d.uniform_name);
        }
    }

    // ===== Phase 1: 个体参考图 =====
    if (individualPairs.length > 0) {
        ctx.info(`[generateReferenceImages] Phase1: 生成 ${individualPairs.length} 个实体参考图（按场景隔离）`);
        await pMap(
            individualPairs,
            pair => generateEntityRefsheet(ctx, pair.sceneId, pair.name),
            { concurrency: 4 },
        );
    }

    // ===== Phase 2: 制服三视图 =====
    if (uniforms.size > 0) {
        ctx.info(`[generateReferenceImages] Phase2: 生成 ${uniforms.size} 个制服三视图`);
        await pMap(Array.from(uniforms), name => generateUniformRefsheet(ctx, name), { concurrency: 2 });
    }

    // ===== Phase 3: 群体合照 =====
    if (groupPhotoPairs.length > 0) {
        ctx.info(`[generateReferenceImages] Phase3: 生成 ${groupPhotoPairs.length} 个群体合照（按场景隔离）`);
        await pMap(
            groupPhotoPairs,
            pair => generateGroupPhoto(ctx, pair.sceneId, pair.name),
            { concurrency: 3 },
        );
    }

    // ===== Phase 4: 场景环境图 =====
    const sceneIds = store.sceneIds();
    if (sceneIds.length > 0) {
        ctx.info(`[generateReferenceImages] Phase4: 生成 ${sceneIds.length} 个场景环境图`);
        await pMap(sceneIds, id => generateSceneEnvironment(ctx, id), { concurrency: 3 });
    }

    // ===== Phase 5: 场景镜头提示词 =====
    if (sceneIds.length > 0) {
        ctx.info(`[generateReferenceImages] Phase5: 生成逐场景镜头提示词`);
        await pMap(sceneIds, id => generateSceneShotPrompts(ctx, id), { concurrency: 3 });
    }

    // ===== Phase 6: 构建渲染任务索引（供下游节点） =====
    const refTasks = buildRenderTaskDescriptors(store);
    const eligibleTasks = applyImportanceCutoff(refTasks);
    store.saveRenderTasks(eligibleTasks);
    ctx.info(`[generateReferenceImages] Phase6: 渲染任务索引完成，${eligibleTasks.length}/${refTasks.length} 个任务`);

    await buildOverview(ctx);
}

/** 从 ref_id 反解出用于展示的实体名（env/uniform/entity） */
function displayNameFromRefId(store: RefImgStorage, refId: string): string {
    if (refId.startsWith("env:")) return "场景环境";
    if (refId.startsWith("uniform:")) return refId.slice("uniform:".length);
    const parsed = store.parseEntityRefsheetKey(refId);
    return parsed ? parsed.entityName : refId;
}

function buildRenderTaskDescriptors(store: RefImgStorage): RenderTaskDescriptor[] {
    const tasks: RenderTaskDescriptor[] = [];

    // 实体参考图 + 群体合照
    for (const id of store.generatedEntityRefsheets()) {
        const parsed = store.parseEntityRefsheetKey(id);
        if (!parsed) continue;
        const prompt = store.getEntityRefsheet(parsed.sceneId, parsed.entityName);
        if (!prompt) continue;
        const asset = store.getEntityAsset(parsed.sceneId, parsed.entityName);

        const taskType = prompt.layout === "group_photo" ? "group_photo"
            : prompt.layout === "uniform_turnaround" ? "uniform_turnaround"
                : "entity_refsheet";

        const referenceImages: Array<{ ref_id: string; entity_name: string; role: string }> = [];

        // 前序场景参考图
        if (prompt.previous_scene_refs) {
            for (const prevRefId of prompt.previous_scene_refs) {
                const prevParsed = store.parseEntityRefsheetKey(prevRefId);
                if (!prevParsed) continue;
                referenceImages.push({
                    ref_id: prevRefId,
                    entity_name: prevParsed.entityName,
                    role: "previous_scene_reference（前序场景参考，保持外观一致性）",
                });
            }
        }

        // 群体合照依赖：提升个体
        if (taskType === "group_photo") {
            const stage = store.getStage(parsed.sceneId);
            if (stage) {
                for (const e of stage.entities) {
                    if (e.source_group === prompt.entity_name) {
                        const memberRefId = `${parsed.sceneId}__${e.name}`;
                        referenceImages.push({
                            ref_id: memberRefId,
                            entity_name: e.name,
                            role: "individual_member_reference（已提升的成员参考，保持外观一致）",
                        });
                    }
                }
            }
        }

        tasks.push({
            id,
            type: taskType,
            prompt: prompt.prompt,
            importance: prompt.importance,
            referenced_shot_count: prompt.referenced_shot_count,
            referenced_scene_count: prompt.referenced_scene_count,
            scene_id: parsed.sceneId,
            reference_images: referenceImages.length > 0 ? referenceImages : undefined,
            asset_info: asset ? {
                entity_name: parsed.entityName,
                kind: asset.kind,
                layout: prompt.layout,
                humanoid: prompt.humanoid,
                base_description: asset.base_description,
            } : undefined,
            group_info: taskType === "group_photo" ? {
                group_entity_name: parsed.entityName,
                scene_id: parsed.sceneId,
            } : undefined,
        });
    }

    // 制服
    for (const uniformName of store.uniformPromptIdx()) {
        const prompt = store.getUniformPrompt(uniformName);
        if (!prompt) continue;
        tasks.push({
            id: `uniform:${uniformName}`,
            type: "uniform_turnaround",
            prompt: prompt.prompt,
            importance: prompt.importance,
            referenced_shot_count: prompt.referenced_shot_count,
            referenced_scene_count: prompt.referenced_scene_count,
            scene_id: prompt.scene_id,
            uniform_info: {
                uniform_name: uniformName,
                group_entity_name: store.getUniform(uniformName)?.group_entity_name ?? "",
                wearer_gender: store.getUniform(uniformName)?.wearer_gender ?? "androgynous",
            },
        });
    }

    // 环境图
    for (const sceneId of store.generatedSceneIds()) {
        const env = store.getSceneEnvironment(sceneId);
        if (!env) continue;
        const stage = store.getStage(sceneId);
        const lighting = store.getLighting(sceneId);
        tasks.push({
            id: `env:${sceneId}`,
            type: "scene_environment",
            prompt: env.prompt,
            importance: env.importance,
            referenced_shot_count: env.referenced_shot_count,
            referenced_scene_count: env.referenced_scene_count,
            scene_id: sceneId,
            scene_info: stage && lighting ? {
                scene_id: sceneId,
                environment: stage.world.environment,
                lighting_summary: lighting.summary,
                inline_entities: env.inline_entities,
            } : undefined,
        });
    }

    // ===== 交付帧：场景镜头首尾帧（成片的最终画面）=====
    // SceneShotPrompt.reference_images 的 entity_name 字段实际存放的是 ref_id
    // （env:X / sceneId__name / uniform:X），可直接对应渲染任务 id。
    for (const sceneId of store.sceneIds()) {
        for (const shot of store.getSceneShotPrompts(sceneId)) {
            const referenceImages = shot.reference_images.map(r => ({
                ref_id: r.entity_name,
                entity_name: displayNameFromRefId(store, r.entity_name),
                role: r.role,
            }));
            tasks.push({
                id: `shot:${sceneId}:${shot.shot_index}`,
                type: "scene_shot",
                prompt: shot.prompt,
                importance: 10,
                referenced_shot_count: 1,
                referenced_scene_count: 1,
                scene_id: sceneId,
                reference_images: referenceImages.length > 0 ? referenceImages : undefined,
                shot_info: {
                    scene_id: sceneId,
                    shot_index: shot.shot_index,
                    shot_type: shot.shot_meta.shot_type,
                    camera_movement: shot.shot_meta.camera_movement,
                    duration_estimate: shot.shot_meta.duration_estimate,
                },
            });
        }
    }

    return tasks;
}

/**
 * cutoff：
 * - 交付帧（scene_shot）与环境图（scene_environment）恒定保留（成片必需）。
 * - 二者依赖闭包内的参考图恒定保留（否则成片帧丢引用）。
 * - 仅对"未被任何交付帧/环境引用的冗余参考图"施加 MAX_CONCURRENT_RENDER 预算上限。
 */
function applyImportanceCutoff(tasks: RenderTaskDescriptor[]): RenderTaskDescriptor[] {
    const mustKeep = tasks.filter(t => t.type === "scene_shot" || t.type === "scene_environment");
    const optional = tasks.filter(t => t.type !== "scene_shot" && t.type !== "scene_environment");

    const byId = new Map(tasks.map(t => [t.id, t] as const));

    // 计算 mustKeep 的依赖闭包
    const requiredRefIds = new Set<string>();
    for (const t of mustKeep) {
        for (const r of t.reference_images ?? []) requiredRefIds.add(r.ref_id);
    }
    let changed = true;
    while (changed) {
        changed = false;
        for (const id of Array.from(requiredRefIds)) {
            const dep = byId.get(id);
            if (!dep) continue;
            for (const r of dep.reference_images ?? []) {
                if (!requiredRefIds.has(r.ref_id)) {
                    requiredRefIds.add(r.ref_id);
                    changed = true;
                }
            }
        }
    }

    const requiredOptional = optional.filter(t => requiredRefIds.has(t.id));
    const freeOptional = optional.filter(t => !requiredRefIds.has(t.id));

    const sortedFree = [...freeOptional].sort((a, b) => {
        const aShot = a.referenced_shot_count ?? 0;
        const bShot = b.referenced_shot_count ?? 0;
        if (aShot !== bShot) return bShot - aShot;

        const aScene = a.referenced_scene_count ?? 0;
        const bScene = b.referenced_scene_count ?? 0;
        if (aScene !== bScene) return bScene - aScene;

        return b.importance - a.importance;
    });

    return [...mustKeep, ...requiredOptional, ...sortedFree.slice(0, MAX_CONCURRENT_RENDER)];
}

async function buildOverview(ctx: IRunnerContext): Promise<void> {
    const store = new RefImgStorage(ctx);

    const entityRefsheetIds = store.generatedEntityRefsheets();
    const uniformNames = store.uniformPromptIdx();
    const sceneIds = store.generatedSceneIds();

    if (!checkExpiry(ctx, {
        inputKeys: [
            ...entityRefsheetIds.map(id => {
                const p = store.parseEntityRefsheetKey(id);
                return p ? store.entityRefsheetKey(p.sceneId, p.entityName) : id;
            }),
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

    if (entityRefsheetIds.length) {
        sections.push("# 实体参考图（按场景隔离）");
        for (const id of entityRefsheetIds) {
            const parsed = store.parseEntityRefsheetKey(id);
            if (!parsed) continue;
            const prompt = store.getEntityRefsheet(parsed.sceneId, parsed.entityName);
            if (prompt) sections.push(renderEntitySection(parsed.sceneId, parsed.entityName, prompt));
        }
    }

    if (uniformNames.length) {
        sections.push("# 制服三视图");
        for (const name of uniformNames) {
            const prompt = store.getUniformPrompt(name);
            if (prompt) sections.push(renderEntitySection(prompt.scene_id, name, prompt));
        }
    }

    if (sceneIds.length) {
        sections.push("# 场景环境图（无人物）");
        for (const sceneId of sceneIds) {
            const env = store.getSceneEnvironment(sceneId);
            if (env) sections.push(renderSceneEnvSection(sceneId, env));
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
    sceneId: string,
    name: string,
    prompt: EntityRefsheetPrompt,
): string {
    const layoutLabel = {
        four_column: "16:9 四列（左侧大头 + 右侧全身正/左45/背）",
        three_column: "16:9 三列（正/侧/背）",
        magazine_grid: "16:9 杂志网格",
        uniform_turnaround: "16:9 制服三视图",
        group_photo: "16:9 群体合照（自然站位）",
    }[prompt.layout];

    const srcGroupLabel = prompt.source_group ? `｜提升自群体：${prompt.source_group}` : "";
    const prevRefsLabel = prompt.previous_scene_refs && prompt.previous_scene_refs.length > 0
        ? `｜前序场景参考：${prompt.previous_scene_refs.join("、")}`
        : "";

    return [
        `## ${sceneId} / ${name}（${prompt.kind}${prompt.humanoid ? "·类人" : ""}${srcGroupLabel}${prevRefsLabel}）`,
        `布局：${layoutLabel}｜重要度：${prompt.importance}｜跨镜头：${prompt.referenced_shot_count}`,
        ``,
        `### 参考图提示词（纯白背景）`,
        prompt.prompt,
    ].join("\n");
}

function renderSceneEnvSection(
    sceneId: string,
    env: SceneEnvironmentPrompt,
): string {
    return [
        `## 场景 ${sceneId} 环境图`,
        `现实参照：${env.real_world_references.join("、") || "（无）"}`,
        `含参考图的陈设/道具：${env.refsheet_entities.join("、") || "（无）"}`,
        `内联描述的陈设：${env.inline_entities.map(e => e.name).join("、") || "（无）"}`,
        `排除的动态道具：${env.excluded_dynamic_props.join("、") || "（无）"}`,
        `评审轮次：${env.review_round}（${env.review_history.map(r => r.verdict).join(" → ")}）`,
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