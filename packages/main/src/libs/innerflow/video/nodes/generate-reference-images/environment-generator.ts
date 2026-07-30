// nodes/generate-reference-images/environment-generator.ts
import { checkExpiry } from "$libs/blueprint/glossary/expiry.js";
import { getSmartModel } from "$libs/model/balancer/get-smart-model.js";
import type { IRunnerContext } from "$types/blueprint/context.js";
import { generateText } from "ai";
import { ENVIRONMENT_BASE_PROMPT } from "./prompts/environment-base.js";
import { buildRefsheetStyleSection } from "./prompts/refsheet-style.js";
import { RefImgStorage } from "./storage.js";
import type { SceneEnvironmentPrompt } from "./types.js";

const P = "#video:";

/**
 * 为单个场景生成环境基底图提示词。
 *
 * 源头治理：
 * 1. 不调用 character/light 实体的任何描述字段
 * 2. 所有 set/prop 实体的描述**都进 prompt 输入**——有独立参考图的用于
 *    渲染时上传参考图，无独立参考图的描述必须进入环境提示词正文（否则丢失）
 * 3. prompt 不接收任何"inlineCharacterDescriptions"之类的字段——从接口设计源头切断
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

    if (!stage || !lighting || !alignedText) {
        ctx.warn(`[generateSceneEnvironment] ${sceneId} 缺少上游输入，跳过`);
        return null;
    }

    const globalStyle = store.getGlobalStyle();
    const styleSection = buildRefsheetStyleSection({
        style: globalStyle.style,
        color_tone: globalStyle.color_tone,
    });

    const allDecisions = store.allRenderDecisions();

    // 源头：只遍历 set/prop，character/light 完全不进入
    const setForPrompt: Array<{ name: string; appearance: string }> = [];
    const propForPrompt: Array<{ name: string; appearance: string }> = [];
    const refsheetEntities: string[] = [];

    for (const e of stage.entities) {
        if (e.kind !== "set" && e.kind !== "prop") continue;

        const globalName = store.resolveToGlobalName(sceneId, e.name);
        const decision = allDecisions.find(d => d.name === globalName);
        const asset = store.getEntityAssetForScene(sceneId, globalName);
        // 源头：有参考图时也保留描述（用于环境图正文中定位它），不丢
        const description = asset?.base_description || e.appearance || "";

        if (decision?.strategy === "individual_refsheet") {
            refsheetEntities.push(globalName);
        }

        // 源头：无论是否有参考图，描述都进 prompt 输入
        const bucket = e.kind === "set" ? setForPrompt : propForPrompt;
        bucket.push({ name: globalName, appearance: description });
    }

    const lightingSection = [
        `主光：${lighting.key_light_direction}，${lighting.key_light_color}`,
        `补光：${lighting.fill_light}`,
        `轮廓光/环境：${lighting.ambient}`,
        `整体效果：${lighting.summary}`,
    ].join("\n");

    // 源头：prompt 输入只传空间/陈设/道具/光照，不传任何人物/角色字段
    const { text } = await generateText({
        model: getSmartModel(undefined, ctx),
        instructions: ENVIRONMENT_BASE_PROMPT.system(styleSection),
        prompt: ENVIRONMENT_BASE_PROMPT.user({
            sceneId,
            environment: stage.world.environment,
            setEntities: setForPrompt,
            propEntities: propForPrompt,
            lighting: lightingSection,
            sceneText: alignedText,
        }),
    });

    const prompt = text.trim();
    const realWorldRefs = extractRealWorldReferences(prompt);

    // 内联实体 = 无独立参考图的 set/prop（在场景提示词中以文字描述它们）
    const inlineEntities = [
        ...setForPrompt, ...propForPrompt,
    ]
        .filter(e => !refsheetEntities.includes(e.name))
        .map(e => ({ name: e.name, description: e.appearance }));

    const env: SceneEnvironmentPrompt = {
        scene_id: sceneId,
        prompt,
        real_world_references: realWorldRefs,
        importance: 8,
        refsheet_entities: refsheetEntities,
        inline_entities: inlineEntities,
    };

    store.saveSceneEnvironment(env);
    ctx.info(
        `[generateSceneEnvironment] ${sceneId} 环境图完成（参考图实体 ${refsheetEntities.length}，内联实体 ${inlineEntities.length}）`,
    );
    return env;
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