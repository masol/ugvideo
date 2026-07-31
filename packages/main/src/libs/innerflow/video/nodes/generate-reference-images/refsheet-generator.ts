// nodes/generate-reference-images/refsheet-generator.ts
import { checkExpiry } from "$libs/blueprint/glossary/expiry.js";
import { getSmartModel } from "$libs/model/balancer/get-smart-model.js";
import type { IRunnerContext } from "$types/blueprint/context.js";
import { generateText } from "ai";
import { buildLayoutTemplate, ENTITY_REFSHEET_PROMPT } from "./prompts/entity-refsheet.js";
import { getRefsheetSkill, pickRefsheetSkill } from "./prompts/refsheet-skill.js";
import type { RefsheetAnchorKind } from "./prompts/refsheet-style.js";
import { buildRefsheetStyleSection, getRefsheetStyleAnchor } from "./prompts/refsheet-style.js";
import { UNIFORM_REFSHEET_PROMPT } from "./prompts/uniform-refsheet.js";
import { RefImgStorage } from "./storage.js";
import type { EntityRefsheetPrompt, RefsheetLayout } from "./types.js";

const P = "#video:";

/**
 * 生成次序约束（消除循环依赖）：
 *   Phase 1: 个体参考图（含 source_group 提升个体）→ 不引用群体合照
 *   Phase 2: 制服三视图（独立）
 *   Phase 3: 群体合照 → 可引用已生成的提升个体图（Phase 1 已完成）
 *
 * 提升个体的服装一致性靠：
 *   1. 群体制服设计（更早阶段产出，由 design-characters 阶段注入）
 *   2. 上游 costume 信息（按场景隔离，已按场景生成）
 *
 * 不靠群体合照反向锚定（避免循环依赖）。
 */

export async function generateEntityRefsheet(
    ctx: IRunnerContext,
    sceneId: string,
    entityName: string,
): Promise<EntityRefsheetPrompt | null> {
    const store = new RefImgStorage(ctx);

    const decision = store.getRenderDecision(sceneId, entityName);
    if (!decision || decision.strategy !== "individual_refsheet") {
        return null;
    }

    const globalStyle = store.getGlobalStyle();
    const styleSection = buildRefsheetStyleSection({
        style: globalStyle.style,
        color_tone: globalStyle.color_tone,
    });

    if (decision.source_group) {
        return generateSourceGroupIndividualRefsheet(ctx, store, sceneId, entityName, decision, styleSection, globalStyle.style);
    }

    const entity = store.getGlobalEntity(entityName);
    if (!entity) {
        ctx.warn(`[generateEntityRefsheet] 实体不存在：${entityName}`);
        return null;
    }
    if (entity.kind === "light") return null;

    // 查询同一实体在前序场景的参考图（跨场景一致性索引）
    const previousSceneRefs = store.getPreviousSceneRefs(entityName, sceneId);

    if (!checkExpiry(ctx, {
        inputKeys: [
            `${P}shots:asset_${sceneId}_${entityName}`,
            `${P}char:identity_${entityName}`,
            `${P}char:costume_${entityName}_${sceneId}`,
            `${P}char:render_decision_${sceneId}_${entityName}`,
            "config:style",
            "config:colorTone",
            ...previousSceneRefs.map(id => store.entityRefsheetKeyFromId(id)),
        ],
        outputKeys: store.entityRefsheetKey(sceneId, entityName),
    })) {
        const cached = store.getEntityRefsheet(sceneId, entityName);
        if (cached) return cached;
    }

    const asset = store.getEntityAsset(sceneId, entityName);
    if (!asset) {
        ctx.warn(`[generateEntityRefsheet] ${sceneId}/${entityName} 缺少素材描述，跳过`);
        return null;
    }

    const identity = store.getIdentity(entityName);
    const layout = decideLayout(entity.kind, entity.humanoid, asset.base_description);
    const skill = getRefsheetSkill(pickRefsheetSkill(entity.kind, entity.humanoid));
    const anchorKind = pickAnchorKind(entity.kind, entity.humanoid);
    const styleAnchor = getRefsheetStyleAnchor(globalStyle.style, anchorKind);
    const layoutTemplate = buildLayoutTemplate(
        layout as "four_column" | "three_column" | "magazine_grid",
        entity.humanoid,
        entity.kind,
        styleAnchor,
    );

    const { text } = await generateText({
        model: getSmartModel(undefined, ctx),
        instructions: ENTITY_REFSHEET_PROMPT.system(styleSection, skill),
        prompt: ENTITY_REFSHEET_PROMPT.user({
            entityName,
            kind: entity.kind,
            humanoid: entity.humanoid,
            ethnicity: identity?.ethnicity ?? "未指定族裔（人类角色默认东亚汉族面部特征）",
            layout: layout as "four_column" | "three_column" | "magazine_grid",
            baseDescription: asset.base_description,
            styleAnchor,
            layoutTemplate,
        }),
    });

    const refsheet: EntityRefsheetPrompt = {
        entity_name: entityName,
        scene_id: sceneId,
        kind: entity.kind as "character" | "prop" | "set",
        humanoid: entity.humanoid,
        layout,
        prompt: text.trim(),
        source_scene: sceneId,
        importance: decision.importance,
        referenced_shot_count: decision.referenced_shot_count,
        referenced_scene_count: decision.referenced_scene_count,
        previous_scene_refs: previousSceneRefs,
    };
    store.saveEntityRefsheet(refsheet);
    ctx.info(`[generateEntityRefsheet] ${sceneId}/${entityName} 参考图提示词完成（${layout}）${previousSceneRefs.length ? `，关联前序场景 ${previousSceneRefs.length} 个` : ""}`);
    return refsheet;
}

/**
 * source_group 提升个体的参考图（场景隔离）。
 *
 * 一致性来源：
 * - 群体制服设计（来自 design-characters，统一注入）
 * - 上游 costume 信息（按场景隔离）
 *
 * 不引用群体合照（生成次序约束：个体先生成）。
 */
async function generateSourceGroupIndividualRefsheet(
    ctx: IRunnerContext,
    store: RefImgStorage,
    sceneId: string,
    entityName: string,
    decision: { source_group?: string; importance: number; referenced_shot_count: number; referenced_scene_count: number },
    styleSection: string,
    style: string,
): Promise<EntityRefsheetPrompt | null> {
    const found = store.findSourceGroupEntity(entityName);
    if (!found) {
        ctx.warn(`[generateEntityRefsheet] source_group 个体未找到：${entityName}`);
        return null;
    }

    const entitySceneId = found.sceneId;
    const stageEntity = found.stageEntity;

    if (!checkExpiry(ctx, {
        inputKeys: [
            `${P}state:stage_${entitySceneId}`,
            `${P}shots:asset_${entitySceneId}_${entityName}`,
            `${P}char:render_decision_${sceneId}_${entityName}`,
            "config:style",
            "config:colorTone",
        ],
        outputKeys: store.entityRefsheetKey(sceneId, entityName),
    })) {
        const cached = store.getEntityRefsheet(sceneId, entityName);
        if (cached) return cached;
    }

    const asset = store.getEntityAsset(entitySceneId, entityName);
    const baseDescription = asset?.base_description || stageEntity.appearance || "";
    if (!baseDescription) {
        ctx.warn(`[generateEntityRefsheet] source_group 个体 ${entityName} 无外观描述，跳过`);
        return null;
    }

    // 群体制服引用（design-characters 阶段已产出，安全）
    let uniformReference = "";
    const uniformName = decision.source_group ? `${decision.source_group}制服` : "";
    if (uniformName) {
        const uniform = store.getUniform(uniformName);
        if (uniform) {
            uniformReference = [
                uniform.description,
                ...uniform.items.map(it => `- ${it.item}：${it.material}，${it.color}`),
            ].join("\n");
        }
    }

    const skill = getRefsheetSkill("character_humanoid");
    const styleAnchor = getRefsheetStyleAnchor(style, "character_humanoid");
    const layoutTemplate = buildLayoutTemplate("four_column", true, "character", styleAnchor);

    const userPrompt = [
        `【实体】${entityName}（character, source_group=${decision.source_group ?? ""}）`,
        `【族裔】东亚汉族面部特征`,
        `【构图模板】${layoutTemplate}`,
        ``,
        `【跨场景不变的基础外观描述】`,
        baseDescription,
        ``,
        uniformReference ? `【所属群体的制服设计（本个体服装必须与此制服一致）】\n${uniformReference}\n` : "",
        `请直接输出提示词。记住：纯白背景、无场景光照（仅 studio lighting）、无任何动作（仅中性站姿；大头区域表情中性视线平视）、无空间定位、无 meta 声明、无编号、无场景变化。`,
    ].filter(Boolean).join("\n");

    const { text } = await generateText({
        model: getSmartModel(undefined, ctx),
        instructions: ENTITY_REFSHEET_PROMPT.system(styleSection, skill),
        prompt: userPrompt,
    });

    const refsheet: EntityRefsheetPrompt = {
        entity_name: entityName,
        scene_id: sceneId,
        kind: "character",
        humanoid: true,
        layout: "four_column",
        prompt: text.trim(),
        source_scene: entitySceneId,
        importance: decision.importance,
        referenced_shot_count: decision.referenced_shot_count,
        referenced_scene_count: decision.referenced_scene_count,
        source_group: decision.source_group,
        previous_scene_refs: [],
    };
    store.saveEntityRefsheet(refsheet);
    ctx.info(
        `[generateEntityRefsheet] source_group 个体 ${sceneId}/${entityName} 参考图完成`
        + (uniformReference ? "（含制服依赖）" : ""),
    );
    return refsheet;
}

/**
 * 群体合照（按场景隔离）。
 *
 * 生成次序：Phase 3，在个体参考图（Phase 1）完成后执行。
 * 此时可读取已生成的 source_group 提升个体图作为成员一致性锚点。
 *
 * 注意：群体合照本身不被任何个体引用（避免循环）。
 */
export async function generateGroupPhoto(
    ctx: IRunnerContext,
    sceneId: string,
    groupName: string,
): Promise<EntityRefsheetPrompt | null> {
    const store = new RefImgStorage(ctx);

    const entity = store.getGlobalEntity(groupName);
    if (!entity) {
        ctx.warn(`[generateGroupPhoto] 群体不存在：${groupName}`);
        return null;
    }

    const decision = store.getRenderDecision(sceneId, groupName);
    if (!decision || decision.strategy !== "group_photo") return null;

    // 注入该场景已独立生成的提升个体作为成员参考（确保视觉一致）
    // 此时 Phase 1 已完成，可以安全读取
    const stage = store.getStage(sceneId);
    const individualMembers: Array<{ name: string; appearance: string; refId: string }> = [];
    if (stage) {
        for (const e of stage.entities) {
            if (e.source_group === groupName) {
                const memberAsset = store.getEntityAsset(sceneId, e.name);
                if (memberAsset?.base_description) {
                    const refId = `${sceneId}__${e.name}`;
                    individualMembers.push({
                        name: e.name,
                        appearance: memberAsset.base_description,
                        refId,
                    });
                }
            }
        }
    }

    const individualRefIds = individualMembers.map(m => m.refId);

    if (!checkExpiry(ctx, {
        inputKeys: [
            `${P}shots:asset_${sceneId}_${groupName}`,
            `${P}stage:registry:${groupName}`,
            `${P}char:render_decision_${sceneId}_${groupName}`,
            "config:style",
            "config:colorTone",
            ...individualRefIds.map(id => store.entityRefsheetKeyFromId(id)),
        ],
        outputKeys: store.entityRefsheetKey(sceneId, groupName),
    })) {
        const cached = store.getEntityRefsheet(sceneId, groupName);
        if (cached) return cached;
    }

    const asset = store.getEntityAsset(sceneId, groupName);
    const baseDescription = asset?.base_description || entity.appearance || "";
    if (!baseDescription) {
        ctx.warn(`[generateGroupPhoto] ${sceneId}/${groupName} 无外观描述，跳过`);
        return null;
    }

    const identity = store.getIdentity(groupName);
    const globalStyle = store.getGlobalStyle();
    const styleSection = buildRefsheetStyleSection({
        style: globalStyle.style,
        color_tone: globalStyle.color_tone,
    });
    const countLabel = entity.count === 0 ? "群体" : `${entity.count}`;
    const skill = getRefsheetSkill("group_photo");
    const styleAnchor = getRefsheetStyleAnchor(globalStyle.style, "group_photo");
    const layoutTemplate = buildLayoutTemplate("group_photo", true, "character", styleAnchor, countLabel);

    const memberAnchor = individualMembers.length > 0
        ? `【已独立抽取的成员（必须在合照中保持外观一致）】\n${individualMembers.map(m => `- ${m.name}：${m.appearance.slice(0, 200)}`).join("\n")}`
        : "";

    const { text } = await generateText({
        model: getSmartModel(undefined, ctx),
        instructions: ENTITY_REFSHEET_PROMPT.system(styleSection, skill),
        prompt: ENTITY_REFSHEET_PROMPT.user({
            entityName: groupName,
            kind: "character",
            humanoid: true,
            ethnicity: identity?.ethnicity ?? "东亚汉族面部特征",
            layout: "group_photo",
            baseDescription,
            styleAnchor,
            layoutTemplate,
            groupCount: countLabel,
        }) + (memberAnchor ? `\n\n${memberAnchor}` : ""),
    });

    const refsheet: EntityRefsheetPrompt = {
        entity_name: groupName,
        scene_id: sceneId,
        kind: "character",
        humanoid: true,
        layout: "group_photo",
        prompt: text.trim(),
        source_scene: sceneId,
        importance: decision.importance,
        referenced_shot_count: decision.referenced_shot_count,
        referenced_scene_count: decision.referenced_scene_count,
        previous_scene_refs: individualRefIds,
    };
    store.saveEntityRefsheet(refsheet);
    ctx.info(`[generateGroupPhoto] ${sceneId}/${groupName} 群体合照提示词完成${memberAnchor ? `（含提升个体锚点 ${individualMembers.length} 个）` : ""}`);
    return refsheet;
}

/**
 * 制服三视图（全局共享，但附 scene_id 作为元数据）。
 */
export async function generateUniformRefsheet(
    ctx: IRunnerContext,
    uniformName: string,
): Promise<EntityRefsheetPrompt | null> {
    const store = new RefImgStorage(ctx);
    const uniform = store.getUniform(uniformName);
    if (!uniform) {
        ctx.warn(`[generateUniformRefsheet] 制服不存在：${uniformName}`);
        return null;
    }
    if (!checkExpiry(ctx, {
        inputKeys: [
            `${P}char:uniform_${uniformName}`,
            "config:style",
            "config:colorTone",
        ],
        outputKeys: store.uniformPromptKey(uniformName),
    })) {
        const cached = store.getUniformPrompt(uniformName);
        if (cached) return cached;
    }
    const globalStyle = store.getGlobalStyle();
    const styleSection = buildRefsheetStyleSection({
        style: globalStyle.style,
        color_tone: globalStyle.color_tone,
    });
    const styleAnchor = getRefsheetStyleAnchor(globalStyle.style, "uniform");
    const { text } = await generateText({
        model: getSmartModel(undefined, ctx),
        instructions: UNIFORM_REFSHEET_PROMPT.system(styleSection),
        prompt: UNIFORM_REFSHEET_PROMPT.user({
            uniformName,
            groupEntityName: uniform.group_entity_name,
            eraReference: uniform.era_reference,
            silhouetteKeywordsEn: uniform.silhouette_keywords_en,
            items: uniform.items,
            wearerGender: uniform.wearer_gender,
            wearerBodyType: uniform.wearer_body_type,
            styleAnchor,
        }),
    });
    const groupEntity = store.getGlobalEntity(uniform.group_entity_name);
    const refsheet: EntityRefsheetPrompt = {
        entity_name: uniformName,
        scene_id: groupEntity?.scenes[0] ?? "unknown",
        kind: "character",
        humanoid: true,
        layout: "uniform_turnaround",
        prompt: text.trim(),
        source_scene: groupEntity?.scenes[0] ?? "unknown",
        importance: 7,
        referenced_shot_count: 0,
        referenced_scene_count: groupEntity ? groupEntity.scenes.length : 0,
        previous_scene_refs: [],
    };
    store.saveUniformPrompt(refsheet);
    ctx.info(`[generateUniformRefsheet] ${uniformName} 制服三视图提示词完成`);
    return refsheet;
}

function decideLayout(kind: string, humanoid: boolean, baseDescription: string): RefsheetLayout {
    if (kind !== "character") return "three_column";
    if (humanoid) return "four_column";
    const horizontalKeywords = [
        "蛇", "龙", "鳗", "虫", "百足", "蜈蚣", "细长", "长形",
        "snake", "dragon", "eel", "worm", "centipede", "elongate",
        "体长", "body length", "横向", "lateral",
    ];
    const lowerDesc = baseDescription.toLowerCase();
    return horizontalKeywords.some(kw => lowerDesc.includes(kw.toLowerCase())) ? "magazine_grid" : "three_column";
}

function pickAnchorKind(kind: string, humanoid: boolean): RefsheetAnchorKind {
    if (kind === "character") return humanoid ? "character_humanoid" : "character_non_humanoid";
    if (kind === "prop") return "prop";
    return "prop";
}