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
 *
 * 源头约束：只读 entity 的 base_description（跨场景不变部分）。
 * 不读 scene_delta，不读 lighting_effect——从源头切断了"本场景变化"污染。
 */
export async function generateEntityRefsheet(
    ctx: IRunnerContext,
    entityName: string,
): Promise<EntityRefsheetPrompt | null> {
    const store = new RefImgStorage(ctx);

    const entity = store.getGlobalEntity(entityName);
    if (!entity) {
        ctx.warn(`[generateEntityRefsheet] 实体不存在：${entityName}`);
        return null;
    }

    if (entity.kind === "light") return null;

    const decision = store.getRenderDecision(entityName);
    if (!decision || decision.strategy !== "individual_refsheet") {
        return null;
    }

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

    const globalStyle = store.getGlobalStyle();
    const styleSection = buildRefsheetStyleSection({
        style: globalStyle.style,
        color_tone: globalStyle.color_tone,
    });

    const layout = decideLayout(entity.kind, entity.humanoid, asset.base_description);
    const skill = getRefsheetSkill(pickRefsheetSkill(entity.kind, entity.humanoid));

    // 源头：只传 base_description，不传 scene_delta / lighting_effect
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
    };

    store.saveEntityRefsheet(refsheet);
    ctx.info(`[generateEntityRefsheet] ${entityName} 参考图提示词完成（${layout}）`);
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

    const refsheet: EntityRefsheetPrompt = {
        entity_name: uniformName,
        kind: "character",
        humanoid: true,
        layout: "uniform_turnaround",
        prompt: text.trim(),
        source_scene: store.getGlobalEntity(uniform.group_entity_name)?.scenes[0] ?? "unknown",
        importance: 7,
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