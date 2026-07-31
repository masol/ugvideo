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

    const sceneDecisions = store.getSceneDecisions(sceneId);

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

        // 注意：这里用 raw 的 entity_name 即可（同一实体名在不同场景是不同图）。
        // 下游 I2I 引擎拿到 name 后，自行通过 (sceneId, name) 复合键查正确图片。
        // 简化做法：entity_name 不带 sceneId 前缀，但传 sceneId 在 prompt 中作上下文。
        const referenceImages: Array<{ entity_name: string; role: string }> = [];
        const inlineForShot: Array<{ name: string; description: string }> = [];
        const seenRefs = new Set<string>();
        const seenInline = new Set<string>();

        const pushRef = (entityName: string, role: string): void => {
            if (!entityName || seenRefs.has(entityName)) return;
            seenRefs.add(entityName);
            referenceImages.push({ entity_name: entityName, role });
        };
        const pushInline = (name: string, description: string): void => {
            if (!name || !description || seenInline.has(name)) return;
            seenInline.add(name);
            inlineForShot.push({ name, description });
        };

        // 环境参考图作为空间锚定
        pushRef(`env:${sceneId}`, "environment_reference（保持空间布局与光影基调）");

        for (const localName of referencedLocalNames) {
            const globalName = localToGlobal.get(localName) ?? localName;
            const stageEntity = stageEntityByLocal.get(localName);
            const entity = store.getGlobalEntity(globalName);

            // source_group 提升个体（不在全局登记册）
            if (!entity && stageEntity?.source_group) {
                const decision = sceneDecisions.find(d => d.name === stageEntity.name);
                if (decision?.strategy === "individual_refsheet") {
                    pushRef(
                        stageEntity.name,
                        "face_and_appearance_reference（严格保持脸部特征、五官比例、服装外观）",
                    );
                } else {
                    pushInlineForSourceGroup(sceneId, stageEntity, store, pushInline);
                }
                continue;
            }

            if (!entity || entity.kind === "light") continue;

            const decision = sceneDecisions.find(d => d.name === globalName);

            if (decision?.strategy === "individual_refsheet") {
                // 同一 globalName 在不同场景是不同图；下游查图时需结合 sceneId
                pushRef(globalName, refRole(entity.kind, entity.humanoid, entity.origin));
            } else if (decision?.strategy === "uniform_refsheet" && decision.uniform_name) {
                pushRef(
                    decision.uniform_name,
                    "costume_reference（参考制服款式，群体成员统一着装）",
                );
            } else if (decision?.strategy === "group_photo") {
                pushRef(
                    globalName,
                    "group_reference（参考群体整体视觉风格与人数，成员着装体型统一）",
                );
            } else if (decision?.strategy === "skip") {
                continue;
            } else {
                if ((entity.kind === "set" || entity.kind === "prop")
                    && initialSetProps.has(globalName)) {
                    const asset = store.getEntityAssetForScene(sceneId, globalName);
                    const desc = asset?.base_description || entity.appearance || "";
                    pushInline(globalName, desc);
                }
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
    pushInline: (name: string, description: string) => void,
): void {
    const asset = store.getEntityAssetForScene(sceneId, stageEntity.name);
    const desc = asset?.base_description || stageEntity.appearance || "";
    pushInline(stageEntity.name, desc);
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