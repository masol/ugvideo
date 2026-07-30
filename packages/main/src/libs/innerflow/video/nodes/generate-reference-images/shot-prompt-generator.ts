// nodes/generate-reference-images/shot-prompt-generator.ts
import { checkExpiry } from "$libs/blueprint/glossary/expiry.js";
import { getSmartModel } from "$libs/model/balancer/get-smart-model.js";
import type { IRunnerContext } from "$types/blueprint/context.js";
import { generateText } from "ai";
import { buildRefsheetStyleSection } from "./prompts/refsheet-style.js";
import { SCENE_SHOT_PROMPT } from "./prompts/scene-shot.js";
import { RefImgStorage } from "./storage.js";
import type { SceneShotPrompt } from "./types.js";

const P = "#video:";

/**
 * 为单个场景生成逐镜头提示词。
 *
 * 源头设计：本函数每个场景独立调用，输入只来自该场景的数据。
 * 相同角色在不同场景有独立的镜头提示词，每个 prompt 都引用对应的参考图。
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

    // 场景内所有实体的 local→global 映射，用于识别镜头中引用的实体
    const localToGlobal = new Map<string, string>();
    for (const e of stage.entities) {
        localToGlobal.set(e.name, store.resolveToGlobalName(sceneId, e.name));
    }

    const shotIds: number[] = [];

    for (let i = 0; i < shots.length; i++) {
        const shotIndex = i + 1;
        const shotDesc = shots[i];

        const referencedLocalNames = extractEntityReferences(shotDesc.text);
        const referenceImages: Array<{ entity_name: string; role: string }> = [];
        const inlineForShot: Array<{ name: string; description: string }> = [];

        // 环境参考图作为空间锚定
        referenceImages.push({ entity_name: sceneId, role: "environment_reference（保持空间布局与光影基调）" });

        for (const localName of referencedLocalNames) {
            const globalName = localToGlobal.get(localName) ?? localName;
            const entity = store.getGlobalEntity(globalName);
            if (!entity || entity.kind === "light") continue;

            const decision = store.getRenderDecision(globalName);

            if (decision?.strategy === "individual_refsheet") {
                referenceImages.push({
                    entity_name: globalName,
                    role: refRole(entity.kind, entity.humanoid),
                });
            } else if (decision?.strategy === "uniform_refsheet" && decision.uniform_name) {
                referenceImages.push({
                    entity_name: decision.uniform_name,
                    role: "costume_reference（参考制服款式）",
                });
            } else {
                // 源头：无参考图时，**必须**以 scene_delta + base_description 形式写入本镜
                const asset = store.getEntityAssetForScene(sceneId, globalName);
                const base = asset?.base_description || entity.appearance || "";
                const delta = asset?.scene_delta || "";
                const light = asset?.lighting_effect || "";
                const desc = [base, delta, light].filter(Boolean).join("；");
                if (desc) inlineForShot.push({ name: globalName, description: desc });
            }
        }

        const { text } = await generateText({
            model: getSmartModel(undefined, ctx),
            instructions: SCENE_SHOT_PROMPT.system(styleSection),
            prompt: SCENE_SHOT_PROMPT.user({
                sceneId,
                shotIndex,
                shotDescription: shotDesc.text,
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
                shot_type: shotDesc.shot_type,
                camera_movement: shotDesc.camera_movement,
                duration_estimate: shotDesc.duration,
            },
        };

        store.saveShotPrompt(sceneId, shotIndex, shotPrompt);
        shotIds.push(shotIndex);
    }

    store.saveShotPromptIdx(sceneId, shotIds);
    ctx.info(`[generateSceneShotPrompts] ${sceneId} 完成 ${shotIds.length} 个镜头提示词`);
}

interface ParsedShot {
    text: string;
    shot_type: string;
    camera_movement: string;
    duration: string;
}

function splitShots(design: string): ParsedShot[] {
    const blocks = design.split(/^###\s+镜头/m).slice(1);
    const shots: ParsedShot[] = [];

    for (const block of blocks) {
        const text = ("镜头" + block).trim();
        shots.push({
            text,
            shot_type: pickField(text, "景别") || "MS",
            camera_movement: pickField(text, "运镜") || "固定",
            duration: extractDuration(text),
        });
    }

    return shots;
}

function pickField(text: string, label: string): string {
    const m = text.match(new RegExp(`${label}[：:]\\s*([^\\n｜]+)`));
    return m ? m[1].trim() : "";
}

function extractDuration(text: string): string {
    const header = text.split("\n")[0] ?? "";
    const m = header.match(/约?\s*(\d+)\s*秒/);
    return m ? `约${m[1]}秒` : "约3秒";
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

function refRole(kind: string, humanoid: boolean): string {
    if (kind === "character") {
        return humanoid
            ? "face_and_appearance_reference（严格保持脸部特征、五官比例、服装外观）"
            : "creature_reference（严格保持形态、体表、比例）";
    }
    if (kind === "prop") return "prop_reference（作为道具，保持材质与细节不变）";
    if (kind === "set") return "set_reference（保持陈设外观）";
    return "reference";
}