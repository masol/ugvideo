// nodes/generate-reference-images/refsheet-generator.ts
import { checkExpiry } from "$libs/blueprint/glossary/expiry.js";
import { getSmartModel } from "$libs/model/balancer/get-smart-model.js";
import type { IRunnerContext } from "$types/blueprint/context.js";
import { generateText } from "ai";
import { ENTITY_REFSHEET_PROMPT } from "./prompts/entity-refsheet.js";
import { getRefsheetSkill, pickRefsheetSkill } from "./prompts/refsheet-skill.js";
import { buildRefsheetStyleSection } from "./prompts/refsheet-style.js";
import { UNIFORM_REFSHEET_PROMPT } from "./prompts/uniform-refsheet.js";
import { RefImgStorage } from "./storage.js";
import type { EntityRefsheetPrompt, RefsheetLayout } from "./types.js";

const P = "#video:";

/**
 * 为单个实体生成全局参考图提示词。
 * 支持两类：
 * - 全局登记册实体（individual_refsheet）
 * - source_group 提升个体（不在登记册，从 stage / design-shots 素材取描述，引用所属群体制服）
 */
export async function generateEntityRefsheet(
    ctx: IRunnerContext,
    entityName: string,
): Promise<EntityRefsheetPrompt | null> {
    const store = new RefImgStorage(ctx);

    const decision = store.getRenderDecision(entityName);
    if (!decision || decision.strategy !== "individual_refsheet") {
        return null;
    }

    const globalStyle = store.getGlobalStyle();
    const styleSection = buildRefsheetStyleSection({
        style: globalStyle.style,
        color_tone: globalStyle.color_tone,
    });

    // 分支 1：source_group 提升个体
    if (decision.source_group) {
        return generateSourceGroupIndividualRefsheet(ctx, store, entityName, decision, styleSection);
    }

    // 分支 2：全局登记册实体
    const entity = store.getGlobalEntity(entityName);
    if (!entity) {
        ctx.warn(`[generateEntityRefsheet] 实体不存在：${entityName}`);
        return null;
    }
    if (entity.kind === "light") return null;

    if (!checkExpiry(ctx, {
        inputKeys: [
            `${P}shots:asset_${entity.scenes[0]}_${entityName}`,
            `${P}char:identity_${entityName}`,
            "config:style",
            "config:colorTone",
        ],
        outputKeys: store.entityRefsheetKey(entityName),
    })) {
        const cached = store.getEntityRefsheet(entityName);
        if (cached) return cached;
    }

    const asset = store.getEntityAsset(entityName);
    if (!asset) {
        ctx.warn(`[generateEntityRefsheet] ${entityName} 缺少素材描述，跳过`);
        return null;
    }

    const identity = store.getIdentity(entityName);
    const layout = decideLayout(entity.kind, entity.humanoid, asset.base_description);
    const skill = getRefsheetSkill(pickRefsheetSkill(entity.kind, entity.humanoid));

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
        }),
    });

    const refsheet: EntityRefsheetPrompt = {
        entity_name: entityName,
        kind: entity.kind as "character" | "prop" | "set",
        humanoid: entity.humanoid,
        layout,
        prompt: text.trim(),
        source_scene: entity.scenes[0],
        importance: decision.importance,
        referenced_shot_count: decision.referenced_shot_count,
        referenced_scene_count: decision.referenced_scene_count,
    };

    store.saveEntityRefsheet(refsheet);
    ctx.info(`[generateEntityRefsheet] ${entityName} 参考图提示词完成（${layout}）`);
    return refsheet;
}

/**
 * source_group 提升个体的参考图。
 * 描述来源：stage.entities 的 appearance + design-shots Pass D 的 base_description。
 * 服装依赖：若所属群体有制服，引用制服设计确保一致。
 */
async function generateSourceGroupIndividualRefsheet(
    ctx: IRunnerContext,
    store: RefImgStorage,
    entityName: string,
    decision: { source_group?: string; importance: number; referenced_shot_count: number; referenced_scene_count: number },
    styleSection: string,
): Promise<EntityRefsheetPrompt | null> {
    // 找到该个体所在的场景与描述
    const found = store.findSourceGroupEntity(entityName);
    if (!found) {
        ctx.warn(`[generateEntityRefsheet] source_group 个体未找到：${entityName}`);
        return null;
    }
    const { sceneId, stageEntity } = found;

    if (!checkExpiry(ctx, {
        inputKeys: [
            `${P}state:stage_${sceneId}`,
            `${P}shots:asset_${sceneId}_${entityName}`,
            "config:style",
            "config:colorTone",
        ],
        outputKeys: store.entityRefsheetKey(entityName),
    })) {
        const cached = store.getEntityRefsheet(entityName);
        if (cached) return cached;
    }

    const asset = store.getEntityAssetForScene(sceneId, entityName);
    const baseDescription = asset?.base_description || stageEntity.appearance || "";
    if (!baseDescription) {
        ctx.warn(`[generateEntityRefsheet] source_group 个体 ${entityName} 无外观描述，跳过`);
        return null;
    }

    // 服装依赖：所属群体制服
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
    const { text } = await generateText({
        model: getSmartModel(undefined, ctx),
        instructions: ENTITY_REFSHEET_PROMPT.system(styleSection, skill),
        prompt: ENTITY_REFSHEET_PROMPT.user({
            entityName,
            kind: "character",
            humanoid: true,
            ethnicity: "东亚汉族面部特征",
            layout: "four_column",
            baseDescription,
            uniformReference: uniformReference || undefined,
        }),
    });

    const refsheet: EntityRefsheetPrompt = {
        entity_name: entityName,
        kind: "character",
        humanoid: true,
        layout: "four_column",
        prompt: text.trim(),
        source_scene: sceneId,
        importance: decision.importance,
        referenced_shot_count: decision.referenced_shot_count,
        referenced_scene_count: decision.referenced_scene_count,
        source_group: decision.source_group,
    };

    store.saveEntityRefsheet(refsheet);
    ctx.info(`[generateEntityRefsheet] source_group 个体 ${entityName} 参考图完成${uniformReference ? "（含制服依赖）" : ""}`);
    return refsheet;
}

/**
 * 群体合照参考图（无制式服装的群体角色）。
 */
export async function generateGroupPhoto(
    ctx: IRunnerContext,
    groupName: string,
): Promise<EntityRefsheetPrompt | null> {
    const store = new RefImgStorage(ctx);

    const entity = store.getGlobalEntity(groupName);
    if (!entity) {
        ctx.warn(`[generateGroupPhoto] 群体不存在：${groupName}`);
        return null;
    }

    const decision = store.getRenderDecision(groupName);
    if (!decision || decision.strategy !== "group_photo") return null;

    if (!checkExpiry(ctx, {
        inputKeys: [
            `${P}shots:asset_${entity.scenes[0]}_${groupName}`,
            `${P}stage:registry:${groupName}`,
            "config:style",
            "config:colorTone",
        ],
        outputKeys: store.entityRefsheetKey(groupName),
    })) {
        const cached = store.getEntityRefsheet(groupName);
        if (cached) return cached;
    }

    const asset = store.getEntityAsset(groupName);
    const baseDescription = asset?.base_description || entity.appearance || "";
    if (!baseDescription) {
        ctx.warn(`[generateGroupPhoto] ${groupName} 无外观描述，跳过`);
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
            groupCount: countLabel,
        }),
    });

    const refsheet: EntityRefsheetPrompt = {
        entity_name: groupName,
        kind: "character",
        humanoid: true,
        layout: "group_photo",
        prompt: text.trim(),
        source_scene: entity.scenes[0],
        importance: decision.importance,
        referenced_shot_count: decision.referenced_shot_count,
        referenced_scene_count: decision.referenced_scene_count,
    };

    store.saveEntityRefsheet(refsheet);
    ctx.info(`[generateGroupPhoto] ${groupName} 群体合照提示词完成`);
    return refsheet;
}

/**
 * 为制服生成三视图提示词。
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
        }),
    });

    const groupEntity = store.getGlobalEntity(uniform.group_entity_name);
    const refsheet: EntityRefsheetPrompt = {
        entity_name: uniformName,
        kind: "character",
        humanoid: true,
        layout: "uniform_turnaround",
        prompt: text.trim(),
        source_scene: groupEntity?.scenes[0] ?? "unknown",
        importance: 7,
        referenced_shot_count: 0,
        referenced_scene_count: groupEntity ? groupEntity.scenes.length : 0,
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