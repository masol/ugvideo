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
import { buildRefsheetStyleSection } from "./prompts/refsheet-style.js";
import { RefImgStorage } from "./storage.js";
import type { SceneEnvironmentPrompt } from "./types.js";

const P = "#video:";
const MAX_ENV_REVIEW_ROUNDS = 2;

/**
 * 为单个场景生成环境基底图提示词（带细化+评审 ReAct）。
 *
 * 三阶段：
 * 1. 初次设计（DESIGN）—— 空间结构 + 固定陈设 + 光照基线
 * 2. 细化（REFINE）—— 沿场景氛围补充痕迹、细节、材质老化
 * 3. 评审（REVIEW）—— 检查设计是否能承载后续剧情（ReAct，最多 2 轮）
 *
 * 道具判定（基于 origin）：
 * - origin="scene" 的 prop/set → 进环境图（fixed_set / inline）
 * - origin="character:..." 的 prop → 不进环境图（dynamic_prop，由镜头提示词消费）
 * - kind="character" / "light" → 一律不进环境图
 */
export async function generateSceneEnvironment(
    ctx: IRunnerContext,
    sceneId: string,
): Promise<SceneEnvironmentPrompt | null> {
    const store = new RefImgStorage(ctx);

    if (!checkExpiry(ctx, {
        inputKeys: [
            `${P}state:stage_${sceneId}`,
            `${P}shots:lighting_${sceneId}`,
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

    const globalStyle = store.getGlobalStyle();
    const styleSection = buildRefsheetStyleSection({
        style: globalStyle.style,
        color_tone: globalStyle.color_tone,
    });

    // ===== 实体分类（基于 origin）=====
    const allDecisions = store.allRenderDecisions();
    const fixedSetForPrompt: Array<{ name: string; appearance: string }> = [];
    const refsheetEntities: string[] = [];
    const excludedDynamicProps: string[] = [];

    for (const e of stage.entities) {
        // character / light 一律不进环境图
        if (e.kind === "character" || e.kind === "light") continue;

        const globalName = store.resolveToGlobalName(sceneId, e.name);
        const decision = allDecisions.find(d => d.name === globalName);
        const asset = store.getEntityAssetForScene(sceneId, globalName);
        const description = asset?.base_description || e.appearance || "";

        // 核心判定：基于 origin
        const origin = e.origin ?? "scene";
        const isDynamic = origin.startsWith("character:");

        if (isDynamic) {
            // 动态道具 → 不进环境图
            excludedDynamicProps.push(globalName);
            ctx.info(`[generateSceneEnvironment] ${sceneId} 动态道具排除：${globalName}（origin=${origin}）`);
            continue;
        }

        // 场景固有 prop/set → 进环境图
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
        instructions: ENVIRONMENT_BASE_PROMPT.system(styleSection),
        prompt: ENVIRONMENT_BASE_PROMPT.user({
            sceneId,
            environment: stage.world.environment,
            fixedSetEntities: fixedSetForPrompt,
            lighting: lightingSection,
            sceneText: alignedText,
        }),
    });
    const designNl = designText.trim();
    ctx.info(`[generateSceneEnvironment] ${sceneId} Phase1 初次设计完成`);

    // ===== Phase 2: 细化 =====
    const moodContext = extractMoodContext(alignedText, stage.spatial_layout);
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
            ctx.warn(`[generateSceneEnvironment] ${sceneId} 达到最大评审轮次 ${MAX_ENV_REVIEW_ROUNDS}，强制通过`);
            break;
        }

        // REVISE：把反馈作为约束再次细化
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

/** 提取场景氛围/剧情上下文（用于细化的合理性推断） */
function extractMoodContext(alignedText: string, spatialLayout: string | null): string {
    const parts: string[] = [];
    parts.push(`【场景原文摘要】\n${alignedText.slice(0, 800)}`);
    if (spatialLayout) {
        parts.push(`【开场站位】\n${spatialLayout}`);
    }
    return parts.join("\n\n");
}

/** 解析评审最后一行 PASS / REVISE */
function parseReviewVerdict(text: string): "PASS" | "REVISE" {
    const lastLine = text.trim().split(/\n+/).filter(Boolean).pop() ?? "";
    const upper = lastLine.toUpperCase();
    if (/\bPASS\b/.test(upper) && !/\bREVISE\b/.test(upper)) return "PASS";
    return "REVISE";
}

/** 提取评审反馈（除最后一行外的所有内容） */
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