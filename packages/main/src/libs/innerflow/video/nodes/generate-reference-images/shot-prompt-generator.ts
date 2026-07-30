// nodes/generate-reference-images/shot-prompt-generator.ts
import { checkExpiry } from "$libs/blueprint/glossary/expiry.js";
import { getSmartModel } from "$libs/model/balancer/get-smart-model.js";
import type { IRunnerContext } from "$types/blueprint/context.js";
import { generateText } from "ai";
import type { StageEntity } from "../align-entities/types.js";
import { buildRefsheetStyleSection } from "./prompts/refsheet-style.js";
import { SCENE_SHOT_PROMPT } from "./prompts/scene-shot.js";
import { RefImgStorage } from "./storage.js";
import type { SceneShotPrompt } from "./types.js";

const P = "#video:";

/**
 * 为单个场景生成逐镜头提示词。
 *
 * 参考图引用规则（按 render decision）：
 * - individual_refsheet（含 source_group 个体）→ 引用个体参考图
 * - uniform_refsheet → 引用制服三视图
 * - group_photo → 引用群体合照
 * - prompt_only + 场景初始 set/prop → inline（融入环境图，不重复外观）
 * - prompt_only + character → 不处理（交给视频生成阶段）
 * - source_group 个体无参考图 → inline 文字描述
 */
export async function generateSceneShotPrompts(
    ctx: IRunnerContext,
    sceneId: string,
): Promise<void> {
    const store = new RefImgStorage(ctx);

    if (!checkExpiry(ctx, {
        inputKeys: [
            `${P}shots:design_${sceneId}`,
            `${P}shots:lighting_${sceneId}`,
            store.sceneEnvironmentKey(sceneId),
            "config:style",
            "config:colorTone",
        ],
        outputKeys: store.shotPromptIdxKey(sceneId),
    })) {
        ctx.info(`[generateSceneShotPrompts] ${sceneId} 镜头提示词仍新鲜，跳过`);
        return;
    }

    const design = store.getShotDesign(sceneId);
    const lighting = store.getLighting(sceneId);
    const stage = store.getStage(sceneId);

    if (!design || !lighting || !stage) {
        ctx.warn(`[generateSceneShotPrompts] ${sceneId} 缺少上游数据，跳过`);
        return;
    }

    const shots = splitShots(design);
    if (shots.length === 0) {
        ctx.warn(`[generateSceneShotPrompts] ${sceneId} 未解析出镜头`);
        return;
    }

    const globalStyle = store.getGlobalStyle();
    const styleSection = buildRefsheetStyleSection({
        style: globalStyle.style,
        color_tone: globalStyle.color_tone,
    });

    const lightingText = [
        `主光：${lighting.key_light_direction}，${lighting.key_light_color}`,
        `补光：${lighting.fill_light}`,
        `整体：${lighting.summary}`,
    ].join("\n");

    // 场景实体映射
    const localToGlobal = new Map<string, string>();
    const initialSetProps = new Set<string>();
    const stageEntityByLocal = new Map<string, StageEntity>();

    for (const e of stage.entities) {
        const globalName = store.resolveToGlobalName(sceneId, e.name);
        localToGlobal.set(e.name, globalName);
        stageEntityByLocal.set(e.name, e);
        if (e.kind === "set" || e.kind === "prop") {
            initialSetProps.add(globalName);
        }
    }

    const shotIds: number[] = [];

    for (let i = 0; i < shots.length; i++) {
        const shotIndex = i + 1;
        const shotDesc = shots[i];

        const referencedLocalNames = extractEntityReferences(shotDesc);
        const referenceImages: Array<{ entity_name: string; role: string }> = [];
        const inlineForShot: Array<{ name: string; description: string }> = [];

        // 环境参考图作为空间锚定
        referenceImages.push({ entity_name: sceneId, role: "environment_reference（保持空间布局与光影基调）" });

        for (const localName of referencedLocalNames) {
            const globalName = localToGlobal.get(localName) ?? localName;
            const stageEntity = stageEntityByLocal.get(localName);
            const entity = store.getGlobalEntity(globalName);
            // source_group 提升个体（不在全局登记册）
            if (!entity && stageEntity?.source_group) {
                const decision = store.getRenderDecision(stageEntity.name);
                if (decision?.strategy === "individual_refsheet") {
                    referenceImages.push({
                        entity_name: stageEntity.name,
                        role: "face_and_appearance_reference（严格保持脸部特征、五官比例、服装外观）",
                    });
                } else {
                    pushInlineForSourceGroup(sceneId, stageEntity, store, inlineForShot);
                }
                continue;
            }
            if (!entity || entity.kind === "light") continue;
            const decision = store.getRenderDecision(globalName);
            if (decision?.strategy === "individual_refsheet") {
                // 包括动态道具（有独立参考图）—— 统一走参考图路径
                referenceImages.push({
                    entity_name: globalName,
                    role: refRole(entity.kind, entity.humanoid, entity.origin),
                });
            } else if (decision?.strategy === "uniform_refsheet" && decision.uniform_name) {
                referenceImages.push({
                    entity_name: decision.uniform_name,
                    role: "costume_reference（参考制服款式，群体成员统一着装）",
                });
            } else if (decision?.strategy === "group_photo") {
                referenceImages.push({
                    entity_name: globalName,
                    role: "group_reference（参考群体整体视觉风格与人数，成员着装体型统一）",
                });
            } else if (decision?.strategy === "skip") {
                continue;
            } else {
                // prompt_only：仅场景初始 set/prop 进 inline（融入环境图）
                // 动态道具 origin≠"scene" 已经有独立参考图，不会进入此分支
                if ((entity.kind === "set" || entity.kind === "prop")
                    && initialSetProps.has(globalName)) {
                    const asset = store.getEntityAssetForScene(sceneId, globalName);
                    const desc = asset?.base_description || entity.appearance || "";
                    if (desc) inlineForShot.push({ name: globalName, description: desc });
                }
                // prompt_only character → 不内联
            }
        }

        const { text } = await generateText({
            model: getSmartModel(undefined, ctx),
            instructions: SCENE_SHOT_PROMPT.system(styleSection),
            prompt: SCENE_SHOT_PROMPT.user({
                sceneId,
                shotIndex,
                shotDescription: shotDesc,
                referenceImages,
                lightingText,
                inlineEntities: inlineForShot,
            }),
        });

        const shotPrompt: SceneShotPrompt = {
            scene_id: sceneId,
            shot_index: shotIndex,
            prompt: text.trim(),
            reference_images: referenceImages,
            shot_meta: {
                shot_type: extractShotType(shotDesc),
                camera_movement: extractCameraMovement(shotDesc),
                duration_estimate: extractDuration(shotDesc),
            },
        };

        store.saveShotPrompt(sceneId, shotIndex, shotPrompt);
        shotIds.push(shotIndex);
    }

    store.saveShotPromptIdx(sceneId, shotIds);
    ctx.info(`[generateSceneShotPrompts] ${sceneId} 完成 ${shotIds.length} 个镜头提示词`);
}

function pushInlineForSourceGroup(
    sceneId: string,
    stageEntity: StageEntity,
    store: RefImgStorage,
    inlineForShot: Array<{ name: string; description: string }>,
): void {
    const asset = store.getEntityAssetForScene(sceneId, stageEntity.name);
    const desc = asset?.base_description || stageEntity.appearance || "";
    if (desc) {
        inlineForShot.push({ name: stageEntity.name, description: desc });
    }
}

function splitShots(design: string): string[] {
    return design.split(/^###\s+镜头/m).slice(1).map(b => "镜头" + b);
}

function extractShotType(text: string): string {
    return pickField(text, "景别") || "MS";
}

function extractCameraMovement(text: string): string {
    return pickField(text, "运镜") || "固定";
}

function extractDuration(text: string): string {
    const header = text.split("\n")[0] ?? "";
    const m = header.match(/约?\s*(\d+)\s*秒/);
    return m ? `约${m[1]}秒` : "约3秒";
}

function pickField(text: string, label: string): string {
    const m = text.match(new RegExp(`${label}[：:]\\s*([^\\n｜]+)`));
    return m ? m[1].trim() : "";
}

function extractEntityReferences(text: string): string[] {
    const pattern = /「([^」]+)」/g;
    const found = new Set<string>();
    for (const match of text.matchAll(pattern)) {
        const name = match[1].trim();
        if (name) found.add(name);
    }
    return Array.from(found);
}

function refRole(kind: string, humanoid: boolean, origin?: string): string {
    if (kind === "character") {
        return humanoid
            ? "face_and_appearance_reference（严格保持脸部特征、五官比例、服装外观）"
            : "creature_reference（严格保持形态、体表、比例）";
    }
    if (kind === "prop") {
        return origin && origin.startsWith("character:")
            ? "prop_reference（动态道具，保持材质/细节/形状在跨镜头中一致）"
            : "prop_reference（保持陈设外观）";
    }
    if (kind === "set") return "set_reference（保持陈设外观）";
    return "reference";
}