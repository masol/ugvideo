// nodes/generate-reference-images/index.ts
import { checkExpiry } from "$libs/blueprint/glossary/expiry.js";
import { configService } from "$libs/store/index.js";
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

export async function generateReferenceImages(ctx: IRunnerContext): Promise<void> {
    const store = new RefImgStorage(ctx);
    const allDecisions = store.allRenderDecisions();

    if (!allDecisions.length) {
        ctx.info("[generateReferenceImages] 无实体决策，跳过");
        return;
    }

    const individualPairs: Array<{ sceneId: string; name: string }> = [];
    const groupPhotoPairs: Array<{ sceneId: string; name: string }> = [];

    for (const d of allDecisions) {
        const sid = d.scene_id ?? "unknown";
        if (d.strategy === "individual_refsheet") {
            individualPairs.push({ sceneId: sid, name: d.name });
        } else if (d.strategy === "group_photo") {
            groupPhotoPairs.push({ sceneId: sid, name: d.name });
        }
    }

    const uniforms = new Set<string>(store.designedUniformNames());

    if (individualPairs.length > 0) {
        ctx.info(`[generateReferenceImages] Phase1: 生成 ${individualPairs.length} 个实体参考图（按场景隔离）`);
        await pMap(
            individualPairs,
            pair => generateEntityRefsheet(ctx, pair.sceneId, pair.name),
            { concurrency: configService().get("concurrency") },
        );
    }

    if (uniforms.size > 0) {
        ctx.info(`[generateReferenceImages] Phase2: 生成 ${uniforms.size} 个制服三视图（覆盖全部已设计制服）`);
        await pMap(Array.from(uniforms), name => generateUniformRefsheet(ctx, name), { concurrency: 2 });
    }

    if (groupPhotoPairs.length > 0) {
        ctx.info(`[generateReferenceImages] Phase3: 生成 ${groupPhotoPairs.length} 个群体合照（按场景隔离）`);
        await pMap(
            groupPhotoPairs,
            pair => generateGroupPhoto(ctx, pair.sceneId, pair.name),
            { concurrency: configService().get("concurrency") },
        );
    }

    const sceneIds = store.sceneIds();
    if (sceneIds.length > 0) {
        ctx.info(`[generateReferenceImages] Phase4: 生成 ${sceneIds.length} 个场景环境图`);
        await pMap(sceneIds, id => generateSceneEnvironment(ctx, id), { concurrency: 3 });
    }

    if (sceneIds.length > 0) {
        ctx.info(`[generateReferenceImages] Phase5: 生成逐场景视频镜头提示词`);
        await pMap(sceneIds, id => generateSceneShotPrompts(ctx, id), { concurrency: 3 });
    }

    const refTasks = buildRenderTaskDescriptors(store);
    store.saveRenderTasks(refTasks);
    ctx.info(`[generateReferenceImages] Phase6: 渲染任务索引完成，${refTasks.length} 个参考图任务（镜头视频提示词另存于 refimg:shot_*，不进渲染）`);

    await buildOverview(ctx);
}

/**
 * 若该实体属于某制服化群体（且该群体制服已设计），返回其应引用的制服三视图 ref_id。
 * 覆盖三类归属：
 * - 提升个体：EntityRefsheetPrompt.source_group
 * - 独立抽取成员：identity.group_member_of
 * - 群体本身（group_photo）：entity_name 即群体名
 *
 * 修正：优先用已存证到 refsheet 的 uniform_name（由 refsheet-generator 设置），
 * 避免再次解析；若 refsheet 尚未携带 uniform_name，回退到解析路径。
 */
function resolveUniformRefId(store: RefImgStorage, prompt: EntityRefsheetPrompt): string | null {
    if (prompt.uniform_name) {
        const exists = store.getUniform(prompt.uniform_name);
        return exists ? `uniform:${prompt.uniform_name}` : null;
    }

    let group: string | null = null;
    if (prompt.source_group) {
        group = prompt.source_group;
    } else if (prompt.layout === "group_photo") {
        group = prompt.entity_name;
    } else {
        const identity = store.getIdentity(prompt.entity_name);
        if (identity?.group_member_of) group = identity.group_member_of;
    }
    if (!group) return null;
    const uniformName = `${group}制服`;
    return store.getUniform(uniformName) ? `uniform:${uniformName}` : null;
}

function buildRenderTaskDescriptors(store: RefImgStorage): RenderTaskDescriptor[] {
    const tasks: RenderTaskDescriptor[] = [];

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

        const uniformRefId = resolveUniformRefId(store, prompt);
        if (uniformRefId) {
            referenceImages.push({
                ref_id: uniformRefId,
                entity_name: uniformRefId.replace(/^uniform:/, ""),
                role: "costume_reference（严格参考制服三视图，保持廓形/材质/色彩/构件与制服一致）",
            });
        }

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

    return tasks;
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
            ...store.sceneIds().map(id => store.shotPromptIdxKey(id)),
            // 新增：制服依赖产物本身。读者扫总览时可同时核对制服三视图 KV。
            // 仅当已设计制服时才有意义，由 checkExpiry 内部处理空入参。
            ...uniformNames.map(n => store.uniformPromptKey(n)),
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
            if (prompt) sections.push(renderEntitySection(store, parsed.sceneId, parsed.entityName, prompt));
        }
    }

    if (uniformNames.length) {
        sections.push("# 制服三视图");
        for (const name of uniformNames) {
            const prompt = store.getUniformPrompt(name);
            if (prompt) sections.push(renderEntitySection(store, prompt.scene_id, name, prompt));
        }
    }

    if (sceneIds.length) {
        sections.push("# 场景环境图（无人物）");
        for (const sceneId of sceneIds) {
            const env = store.getSceneEnvironment(sceneId);
            if (env) sections.push(renderSceneEnvSection(sceneId, env));
        }
    }

    sections.push("# 场景镜头视频提示词（按场景按镜头；全能参考出视频，不渲染静图）");
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

/**
 * 渲染单个参考图条目（含制服归属/前序场景参考/被依赖反向）。
 *
 * 修正：
 * - 新增「应参考制服」字段：基于 prompt.uniform_name 推导；
 *   回退路径覆盖 source_group / identity.group_member_of / group_photo 三条来源，
 *   与 resolveUniformRefId 的回退语义一致。
 * - 新增「被参考」字段：扫描全部 EntityRefsheetPrompt 找出引用了
 *   `${sceneId}__${name}` 的实体（含群成员/前序场景），便于人类核对依赖图。
 */
function renderEntitySection(
    store: RefImgStorage,
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

    // 制服归属展示：优先用 prompt.uniform_name；空时按 resolveUniformRefId 的回退语义显式推导展示
    const uniformName = resolveUniformNameForDisplay(store, prompt);
    const uniformLabel = uniformName
        ? `｜应参考制服：${uniformName}`
        : `｜应参考制服：（无）`;

    // 反向依赖：扫全部 refsheet，找谁把我当成 ref（uniform_turnaround 本身是纯产出，不查）
    const referencedBy = collectReferencedBy(store, sceneId, name, prompt.layout);

    const refByLabel = referencedBy.length > 0
        ? `｜被参考：${referencedBy.join("、")}`
        : "";

    const lines: string[] = [
        `## ${sceneId} / ${name}（${prompt.kind}${prompt.humanoid ? "·类人" : ""}${srcGroupLabel}${uniformLabel}${prevRefsLabel}${refByLabel}）`,
        `布局：${layoutLabel}｜重要度：${prompt.importance}｜跨镜头：${prompt.referenced_shot_count}`,
        ``,
    ];

    // 制服参考图自身的 prompt 字段已是「纯白背景三视图」，不再附额外说明；
    // 其余则附「参考图使用说明」摘要
    if (uniformName && prompt.layout !== "uniform_turnaround") {
        lines.push(`### 制服参考约束（${uniformName}）`);
        lines.push(`本个体的服装必须与该制服三视图保持一致：廓形/材质/色彩/构件以制服为准，本场景如换装/破损另在素材扩写中说明。`);
        lines.push(``);
    }

    lines.push(`### 参考图提示词（纯白背景）`);
    lines.push(prompt.prompt);

    return lines.join("\n");
}

/**
 * 解出用于展示的制服名（与 resolveUniformRefId 同源，但不依赖 ref_id 形式）。
 * 返回 null 表示「无制服归属」。
 */
function resolveUniformNameForDisplay(store: RefImgStorage, prompt: EntityRefsheetPrompt): string | null {
    if (prompt.uniform_name && store.getUniform(prompt.uniform_name)) {
        return prompt.uniform_name;
    }

    let group: string | null = null;
    if (prompt.source_group) {
        group = prompt.source_group;
    } else if (prompt.layout === "group_photo") {
        group = prompt.entity_name;
    } else {
        const identity = store.getIdentity(prompt.entity_name);
        if (identity?.group_member_of) group = identity.group_member_of;
    }
    if (!group) return null;

    const candidateName = `${group}制服`;
    return store.getUniform(candidateName) ? candidateName : null;
}

/**
 * 反向收集：哪些 refsheet 把我（${sceneId}__${name}）列为 previous_scene_refs 或 uniform ref。
 * 制服三视图本身就是纯产出，不查其反向。
 */
function collectReferencedBy(
    store: RefImgStorage,
    sceneId: string,
    name: string,
    selfLayout: EntityRefsheetPrompt["layout"],
): string[] {
    if (selfLayout === "uniform_turnaround") return [];

    const myId = `${sceneId}__${name}`;
    const referencedBy = new Set<string>();
    const allRefsheets = store.generatedEntityRefsheets();

    for (const id of allRefsheets) {
        const parsed = store.parseEntityRefsheetKey(id);
        if (!parsed) continue;
        if (id === myId) continue;

        const p = store.getEntityRefsheet(parsed.sceneId, parsed.entityName);
        if (!p) continue;

        const prevRefs = p.previous_scene_refs ?? [];
        if (prevRefs.includes(myId)) {
            referencedBy.add(id);
        }
    }
    return Array.from(referencedBy);
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