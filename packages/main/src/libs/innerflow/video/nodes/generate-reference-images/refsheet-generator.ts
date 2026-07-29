// nodes/generate-reference-images/refsheet-generator.ts
import { checkExpiry } from "$libs/blueprint/glossary/expiry.js";
import { getSmartModel } from "$libs/model/balancer/get-smart-model.js";
import type { IRunnerContext } from "$types/blueprint/context.js";
import { generateText } from "ai";
import { ENTITY_REFSHEET_PROMPT } from "./prompts/entity-refsheet.js";
import { REFSHEET_SKILL_GENERATOR_PROMPT } from "./prompts/refsheet-skill-generator.js";
import { buildRefsheetStyleSection } from "./prompts/refsheet-style.js";
import { RefImgStorage } from "./storage.js";
import type { EntityRefsheetPrompt, RefsheetLayout } from "./types.js";

const P = "#video:";

/**
 * RAG 占位（固定返回 null）
 */
async function queryRefsheetSkill(_query: string): Promise<string | null> {
    return null;
}

/**
 * 为单个实体生成定妆照提示词。
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

    // light 类不生成定妆照
    if (entity.kind === "light") {
        ctx.info(`[generateEntityRefsheet] ${entityName} 是光源，跳过`);
        return null;
    }

    if (!checkExpiry(ctx, {
        inputKeys: [
            `${P}shots:asset_${entity.scenes[0]}_${entityName}`,
            "config:style",
            "config:colorTone",
        ],
        outputKeys: store.entityRefsheetKey(entityName),
    })) {
        ctx.info(`[generateEntityRefsheet] ${entityName} 定妆照仍新鲜，跳过`);
        const cached = store.getEntityRefsheet(entityName);
        if (cached) return cached;
    }

    const asset = store.getEntityAsset(entityName);
    if (!asset) {
        ctx.warn(`[generateEntityRefsheet] ${entityName} 缺少素材描述，跳过`);
        return null;
    }

    const globalStyle = store.getGlobalStyle();
    const styleSection = buildRefsheetStyleSection({
        style: globalStyle.style,
        color_tone: globalStyle.color_tone,
    });

    // 判断布局
    const layout = decideLayout(entity.kind, entity.humanoid, asset.base_description);

    // 获取 SKILL（翻译步骤）
    const skill = await ensureRefsheetSkill(ctx, entityName, entity.kind, entity.humanoid, layout, globalStyle);

    const { text } = await generateText({
        model: getSmartModel(undefined, ctx),
        instructions: ENTITY_REFSHEET_PROMPT.system(styleSection, skill),
        prompt: ENTITY_REFSHEET_PROMPT.user({
            entityName,
            kind: entity.kind,
            humanoid: entity.humanoid,
            layout,
            baseDescription: asset.base_description,
            sceneDelta: asset.scene_delta,
            lightingEffect: asset.lighting_effect,
        }),
    });

    const refsheet: EntityRefsheetPrompt = {
        entity_name: entityName,
        kind: entity.kind,
        humanoid: entity.humanoid,
        layout,
        prompt: text.trim(),
        dependencies: extractDependencies(text),
        source_scene: entity.scenes[0],
    };

    store.saveEntityRefsheet(refsheet);
    ctx.info(`[generateEntityRefsheet] ${entityName} 定妆照提示词完成（${layout}）`);
    return refsheet;
}

/**
 * 决定布局类型。
 * 启发式规则：
 * - character + humanoid → four_column
 * - character + !humanoid + 横向延展型关键词 → magazine_grid
 * - 其余 → three_column
 */
function decideLayout(kind: string, humanoid: boolean, baseDescription: string): RefsheetLayout {
    if (kind !== "character") return "three_column";

    if (humanoid) return "four_column";

    // 检查横向延展型关键词
    const horizontalKeywords = [
        "蛇", "龙", "鳗", "虫", "百足", "蜈蚣", "细长", "长形",
        "snake", "dragon", "eel", "worm", "centipede", "elongate",
        "体长", "body length", "横向", "lateral",
    ];

    const lowerDesc = baseDescription.toLowerCase();
    const hasHorizontalKeyword = horizontalKeywords.some(kw => lowerDesc.includes(kw.toLowerCase()));

    return hasHorizontalKeyword ? "magazine_grid" : "three_column";
}

/**
 * 获取翻译步骤（SKILL）。
 * RAG 留空 → 固定走 LLM 生成。
 */
async function ensureRefsheetSkill(
    ctx: IRunnerContext,
    entityName: string,
    kind: string,
    humanoid: boolean,
    layout: RefsheetLayout,
    globalStyle: { style: string; color_tone: string },
): Promise<string> {
    const store = new RefImgStorage(ctx);

    if (!checkExpiry(ctx, {
        inputKeys: [
            `${P}shots:asset_${store.getGlobalEntity(entityName)?.scenes[0]}_${entityName}`,
            "config:style",
            "config:colorTone",
        ],
        outputKeys: store.refsheetSkillKey(entityName),
    })) {
        const cached = store.getRefsheetSkill(entityName);
        if (cached) return cached;
    }

    const ragQuery = `${kind}_${humanoid ? "humanoid" : "non_humanoid"}_${layout}`;
    const fromRag = await queryRefsheetSkill(ragQuery);
    if (fromRag) {
        store.saveRefsheetSkill(entityName, fromRag);
        return fromRag;
    }

    const globalStyleStr = `风格：${globalStyle.style}\n色调：${globalStyle.color_tone}`;

    const { text } = await generateText({
        model: getSmartModel(undefined, ctx),
        instructions: REFSHEET_SKILL_GENERATOR_PROMPT.system,
        prompt: REFSHEET_SKILL_GENERATOR_PROMPT.user({
            entityKind: kind,
            humanoid,
            layout,
            globalStyle: globalStyleStr,
        }),
    });

    store.saveRefsheetSkill(entityName, text);
    ctx.info(`[RefsheetSkill] ${entityName} LLM 生成翻译步骤`);
    return text;
}

/**
 * 从提示词中提取 @{} 格式的依赖占位符。
 */
function extractDependencies(prompt: string): string[] {
    const deps = new Set<string>();
    const pattern = /@\{([^}]+)\}/g;
    for (const match of prompt.matchAll(pattern)) {
        deps.add(match[1].trim());
    }
    return Array.from(deps);
}