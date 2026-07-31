// nodes/generate-reference-images/environment-generator.ts
import { checkExpiry } from "$libs/blueprint/glossary/expiry.js";
import { getSmartModel } from "$libs/model/balancer/get-smart-model.js";
import type { IRunnerContext } from "$types/blueprint/context.js";
import { generateText } from "ai";
import {
    ENVIRONMENT_BASE_PROMPT,
    ENVIRONMENT_REFINE_PROMPT,
    ENVIRONMENT_REVIEW_PROMPT,
} from "./prompts/environment-base.js";
import { buildRefsheetStyleSection, getEnvironmentStyleAnchor } from "./prompts/refsheet-style.js";
import { RefImgStorage } from "./storage.js";
import type { SceneEnvironmentPrompt } from "./types.js";

const P = "#video:";
const MAX_ENV_REVIEW_ROUNDS = 2;

export async function generateSceneEnvironment(
    ctx: IRunnerContext,
    sceneId: string,
): Promise<SceneEnvironmentPrompt | null> {
    const store = new RefImgStorage(ctx);

    if (!checkExpiry(ctx, {
        inputKeys: [
            `${P}state:stage_${sceneId}`,
            `${P}shots:lighting_${sceneId}`,
            `${P}shots:intent_${sceneId}`,
            `${P}output:aligned_text_${sceneId}`,
            `${P}state:beat_nl_${sceneId}`,
            `${P}shots:design_${sceneId}`,
            "config:style",
            "config:colorTone",
        ],
        outputKeys: store.sceneEnvironmentKey(sceneId),
    })) {
        ctx.info(`[generateSceneEnvironment] ${sceneId} 环境图仍新鲜，跳过`);
        const cached = store.getSceneEnvironment(sceneId);
        if (cached) return cached;
    }

    const stage = store.getStage(sceneId);
    const lighting = store.getLighting(sceneId);
    const alignedText = store.getAlignedText(sceneId);
    const shotDesign = store.getShotDesign(sceneId);

    if (!stage || !lighting || !alignedText || !shotDesign) {
        ctx.warn(`[generateSceneEnvironment] ${sceneId} 缺少上游输入，跳过`);
        return null;
    }

    const sceneMood = parseSceneMood(store.getIntent(sceneId));

    const globalStyle = store.getGlobalStyle();
    const styleSection = buildRefsheetStyleSection({
        style: globalStyle.style,
        color_tone: globalStyle.color_tone,
    });
    const { imageType: envImageType, anchor: envStyleAnchor } = getEnvironmentStyleAnchor(globalStyle.style);

    // ===== 实体分类（按场景决策）=====
    const sceneDecisions = store.getSceneDecisions(sceneId);
    const fixedSetForPrompt: Array<{ name: string; appearance: string }> = [];
    const refsheetEntities: string[] = [];
    const excludedDynamicProps: string[] = [];

    for (const e of stage.entities) {
        if (e.kind === "character" || e.kind === "light") continue;

        const globalName = store.resolveToGlobalName(sceneId, e.name);
        const decision = sceneDecisions.find(d => d.name === globalName);
        const asset = store.getEntityAssetForScene(sceneId, globalName);
        const description = asset?.base_description || e.appearance || "";

        const origin = e.origin ?? "scene";
        const isDynamic = origin.startsWith("character:");

        if (isDynamic) {
            excludedDynamicProps.push(globalName);
            ctx.info(`[generateSceneEnvironment] ${sceneId} 动态道具排除：${globalName}（origin=${origin}）`);
            continue;
        }

        if (decision?.strategy === "individual_refsheet") {
            refsheetEntities.push(globalName);
        } else {
            fixedSetForPrompt.push({ name: globalName, appearance: description });
        }
    }

    const lightingSection = [
        `主光：${lighting.key_light_direction}，${lighting.key_light_color}`,
        `补光：${lighting.fill_light}`,
        `轮廓光/环境：${lighting.ambient}`,
        `整体效果：${lighting.summary}`,
    ].join("\n");

    // ===== Phase 1: 初次设计 =====
    const { text: designText } = await generateText({
        model: getSmartModel(undefined, ctx),
        instructions: ENVIRONMENT_BASE_PROMPT.system(styleSection, envImageType, envStyleAnchor),
        prompt: ENVIRONMENT_BASE_PROMPT.user({
            sceneId,
            sceneMood,
            envImageType,
            envStyleAnchor,
            environment: stage.world.environment,
            fixedSetEntities: fixedSetForPrompt,
            lighting: lightingSection,
            sceneText: alignedText,
        }),
    });
    const designNl = designText.trim();
    ctx.info(`[generateSceneEnvironment] ${sceneId} Phase1 初次设计完成`);

    // ===== Phase 2: 细化 =====
    const moodContext = buildMoodContext(sceneMood, alignedText, stage.spatial_layout);
    const { text: refineText } = await generateText({
        model: getSmartModel(undefined, ctx),
        instructions: ENVIRONMENT_REFINE_PROMPT.system(styleSection),
        prompt: ENVIRONMENT_REFINE_PROMPT.user({
            sceneId,
            designPrompt: designNl,
            moodContext,
        }),
    });
    const refineNl = refineText.trim();
    ctx.info(`[generateSceneEnvironment] ${sceneId} Phase2 细化完成`);

    // ===== Phase 3: 评审 ReAct =====
    const reviewHistory: SceneEnvironmentPrompt["review_history"] = [];
    let currentPrompt = refineNl;

    for (let round = 1; round <= MAX_ENV_REVIEW_ROUNDS; round++) {
        const { text: reviewText } = await generateText({
            model: getSmartModel(undefined, ctx),
            instructions: ENVIRONMENT_REVIEW_PROMPT.system,
            prompt: ENVIRONMENT_REVIEW_PROMPT.user({
                sceneId,
                designPrompt: currentPrompt,
                sceneText: alignedText,
                shotDesign,
            }),
        });

        const verdict = parseReviewVerdict(reviewText);
        const feedback = parseReviewFeedback(reviewText);

        reviewHistory.push({ round, verdict, feedback });

        if (verdict === "PASS") {
            ctx.info(`[generateSceneEnvironment] ${sceneId} Phase3 评审通过（第${round}轮）`);
            break;
        }

        if (round === MAX_ENV_REVIEW_ROUNDS) {
            ctx.warn(`[generateSceneEnvironment] ${sceneId} 达到最大评审轮次，强制通过`);
            break;
        }

        const { text: reviseText } = await generateText({
            model: getSmartModel(undefined, ctx),
            instructions: ENVIRONMENT_REFINE_PROMPT.system(styleSection),
            prompt: ENVIRONMENT_REFINE_PROMPT.user({
                sceneId,
                designPrompt: currentPrompt,
                moodContext: `${moodContext}\n\n【评审反馈（必须修正）】\n${feedback}`,
            }),
        });
        currentPrompt = reviseText.trim();
        ctx.info(`[generateSceneEnvironment] ${sceneId} Phase3 评审未通过（第${round}轮），已重新细化`);
    }

    const realWorldRefs = extractRealWorldReferences(currentPrompt);
    const inlineEntities = fixedSetForPrompt.map(e => ({
        name: e.name,
        description: e.appearance,
    }));
    const referencedShotCount = countReferencedShots(sceneId, store);

    const env: SceneEnvironmentPrompt = {
        scene_id: sceneId,
        design_nl: designNl,
        refine_nl: refineNl,
        prompt: currentPrompt,
        review_history: reviewHistory,
        real_world_references: realWorldRefs,
        importance: 8,
        refsheet_entities: refsheetEntities,
        inline_entities: inlineEntities,
        excluded_dynamic_props: excludedDynamicProps,
        review_round: reviewHistory.length,
        referenced_shot_count: referencedShotCount,
        referenced_scene_count: 1,
    };

    store.saveSceneEnvironment(env);
    ctx.info(
        `[generateSceneEnvironment] ${sceneId} 完成：固定陈设 ${fixedSetForPrompt.length} 个，参考图陈设 ${refsheetEntities.length} 个，动态道具排除 ${excludedDynamicProps.length} 个，评审轮次 ${reviewHistory.length}`,
    );
    return env;
}

function parseSceneMood(intentNl: string | null): string {
    if (!intentNl) return "（未提供场景意图，请依据场景原文自行判断氛围）";

    const mood = extractField(intentNl, "情绪基调");
    const action = extractField(intentNl, "核心动作");
    const space = extractField(intentNl, "空间类型");
    const rhythm = extractField(intentNl, "内在节奏");

    const parts: string[] = [];
    if (mood) parts.push(`情绪：${mood}`);
    if (action) parts.push(`核心动作：${action}`);
    if (space) parts.push(`空间类型：${space}`);
    if (rhythm) parts.push(`节奏：${rhythm}`);

    return parts.length > 0
        ? parts.join("；")
        : "（未能从意图中提取明确氛围，请依据原文判断）";
}

function buildMoodContext(sceneMood: string, alignedText: string, spatialLayout: string | null): string {
    const parts: string[] = [];
    parts.push(`【场景氛围基调（痕迹密度必须与此一致）】\n${sceneMood}`);
    parts.push(`【场景原文摘要】\n${alignedText.slice(0, 800)}`);
    if (spatialLayout) {
        parts.push(`【开场站位】\n${spatialLayout}`);
    }
    return parts.join("\n\n");
}

function extractField(text: string, label: string): string {
    const m = text.match(new RegExp(`${label}[：:]\\s*(.+)`));
    return m ? m[1].trim() : "";
}

function parseReviewVerdict(text: string): "PASS" | "REVISE" {
    const lastLine = text.trim().split(/\n+/).filter(Boolean).pop() ?? "";
    const upper = lastLine.toUpperCase();
    if (/\bPASS\b/.test(upper) && !/\bREVISE\b/.test(upper)) return "PASS";
    return "REVISE";
}

function parseReviewFeedback(text: string): string {
    const lines = text.trim().split("\n");
    if (lines.length <= 1) return "（无具体反馈）";
    return lines.slice(0, -1).join("\n").trim();
}

function countReferencedShots(sceneId: string, store: RefImgStorage): number {
    const design = store.getShotDesign(sceneId);
    if (!design) return 0;
    return design.split(/^###\s+镜头/m).length - 1;
}

function extractRealWorldReferences(prompt: string): string[] {
    const refs = new Set<string>();
    for (const m of prompt.matchAll(/参考([^\n,.，。]+)/g)) {
        const ref = m[1].trim().replace(/[，。、]/g, "");
        if (ref && ref.length < 50) refs.add(ref);
    }
    for (const m of prompt.matchAll(/inspired by ([^\n,]+(?:and [^\n,]+)?)/gi)) {
        const ref = m[1].trim();
        if (ref && ref.length < 100) refs.add(ref);
    }
    return Array.from(refs).slice(0, 2);
}