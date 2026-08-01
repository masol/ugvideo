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

    const design = store.getShotDesign(sceneId);
    if (!design) {
        ctx.warn(`[generateSceneShotPrompts] ${sceneId} 缺少分镜设计，跳过`);
        return;
    }
    const shots = splitShots(design);
    if (shots.length === 0) {
        ctx.warn(`[generateSceneShotPrompts] ${sceneId} 未解析出镜头`);
        return;
    }

    const lighting = store.getLighting(sceneId);
    const stage = store.getStage(sceneId);
    if (!lighting || !stage) {
        ctx.warn(`[generateSceneShotPrompts] ${sceneId} 缺少上游数据，跳过`);
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
        // 修复：穿着道具（worn_by）不参与镜头参考图计算 —— 其视觉由角色 costume 覆盖
        if (e.kind === "prop" && e.worn_by) continue;

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
        const shotKey = store.shotPromptKey(sceneId, shotIndex);

        if (!checkExpiry(ctx, {
            inputKeys: [
                `${P}shots:design_${sceneId}`,
                `${P}shots:lighting_${sceneId}`,
                store.sceneEnvironmentKey(sceneId),
                "config:style",
                "config:colorTone",
            ],
            outputKeys: shotKey,
        })) {
            ctx.info(`[generateSceneShotPrompts] ${sceneId} 镜头${shotIndex} 仍新鲜，跳过`);
            shotIds.push(shotIndex);
            continue;
        }

        const referencedLocalNames = extractEntityReferences(shotDesc);

        const referenceImages: Array<{ entity_name: string; role: string }> = [];
        const inlineForShot: Array<{ name: string; description: string }> = [];
        const seenRefs = new Set<string>();

        const pushRef = (entityName: string, role: string): void => {
            if (!entityName) return;
            const existing = referenceImages.find(r => r.entity_name === entityName);
            if (existing) {
                if (role.length > existing.role.length) {
                    existing.role = role;
                }
                return;
            }
            seenRefs.add(entityName);
            referenceImages.push({ entity_name: entityName, role });
        };
        const pushInline = (name: string, description: string): void => {
            // 修复：同名实体后出现的覆盖先出现的（保留最新/最具体描述）
            if (!name || !description) return;
            const existingIdx = inlineForShot.findIndex(x => x.name === name);
            if (existingIdx >= 0) {
                inlineForShot[existingIdx] = { name, description };
            } else {
                inlineForShot.push({ name, description });
            }
        };

        pushRef(`env:${sceneId}`, "environment_reference（保持空间布局与光影基调）");

        for (const localName of referencedLocalNames) {
            const globalName = localToGlobal.get(localName) ?? localName;
            const stageEntity = stageEntityByLocal.get(localName);
            const entity = store.getGlobalEntity(globalName);

            // 修复：穿着道具的 stageEntity 已被上一步过滤（不在 stageEntityByLocal），
            // 此处若拿不到 stageEntity 直接跳过
            if (!stageEntity) continue;

            if (!entity && stageEntity.source_group) {
                const decision = sceneDecisions.find(d => d.name === stageEntity.name);
                if (decision?.strategy === "individual_refsheet") {
                    pushRef(
                        `${sceneId}__${stageEntity.name}`,
                        "face_and_appearance_reference（严格保持脸部特征和五官比例）",
                    );
                } else {
                    pushInlineForSourceGroup(sceneId, stageEntity, store, pushInline);
                }
                continue;
            }

            if (!entity || entity.kind === "light") continue;

            const decision = sceneDecisions.find(d => d.name === globalName);

            if (decision?.strategy === "individual_refsheet") {
                pushRef(
                    `${sceneId}__${globalName}`,
                    refRole(entity.kind, entity.humanoid, entity.origin),
                );
                const prevRefs = store.getPreviousSceneRefs(globalName, sceneId);
                if (prevRefs.length > 0) {
                    for (const prevRefId of prevRefs) {
                        pushRef(
                            prevRefId,
                            "previous_scene_appearance_anchor（同一角色前序场景外观基准，确保跨场景面部/体型一致性；本场景如有换装/伤痕以本场景参考图为准）",
                        );
                    }
                }
            } else if (decision?.strategy === "uniform_refsheet" && decision.uniform_name) {
                pushRef(
                    `uniform:${decision.uniform_name}`,
                    "costume_reference（参考制服款式，群体成员统一着装）",
                );
            } else if (decision?.strategy === "group_photo") {
                pushRef(
                    `${sceneId}__${globalName}`,
                    "group_reference（参考群体整体视觉风格与人数，成员着装体型统一）",
                );
                if (stage) {
                    for (const e of stage.entities) {
                        if (e.source_group === globalName) {
                            const memberDecision = sceneDecisions.find(d => d.name === e.name);
                            if (memberDecision?.strategy === "individual_refsheet") {
                                pushRef(
                                    `${sceneId}__${e.name}`,
                                    `individual_member_of_group（${globalName}中已提升的独立成员，保持外观与群体一致）`,
                                );
                            }
                        }
                    }
                }
            } else if (decision?.strategy === "skip") {
                continue;
            } else {
                const prevRefs = store.getPreviousSceneRefs(globalName, sceneId);
                if (prevRefs.length > 0) {
                    const latestPrevRef = prevRefs[prevRefs.length - 1];
                    pushRef(
                        latestPrevRef,
                        "previous_scene_appearance_anchor（同一角色前序场景外观基准，本场景无独立参考图，依赖此图保持一致性）",
                    );
                } else if ((entity.kind === "set" || entity.kind === "prop")
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