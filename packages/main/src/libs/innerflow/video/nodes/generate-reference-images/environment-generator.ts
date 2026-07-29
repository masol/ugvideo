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

    // 收集场景内所有需要作为依赖的实体
    const dependencies = stage.entities
        .filter(e => e.kind !== "light")
        .map(e => e.name);

    // 仅 set 类用于环境描述
    const setEntities = stage.entities
        .filter(e => e.kind === "set")
        .map(e => `- ${e.name}（${e.kind}）：外观 ${e.appearance ?? "无"}`)
        .join("\n");

    const entitiesSection = setEntities || "（本场景无固定陈设）";

    const lightingSection = [
        `主光：${lighting.key_light_direction}，${lighting.key_light_color}`,
        `补光：${lighting.fill_light}`,
        `轮廓光：${lighting.ambient}`,
        `整体效果：${lighting.summary}`,
    ].join("\n");

    const { text } = await generateText({
        model: getSmartModel(undefined, ctx),
        instructions: ENVIRONMENT_BASE_PROMPT.system(styleSection),
        prompt: ENVIRONMENT_BASE_PROMPT.user({
            sceneId,
            environment: stage.world.environment,
            entities: entitiesSection,
            lighting: lightingSection,
            sceneText: alignedText,
            dependencies,
        }),
    });

    // 从提示词中提取现实案例参照
    const realWorldRefs = extractRealWorldReferences(text);

    const env: SceneEnvironmentPrompt = {
        scene_id: sceneId,
        prompt: text.trim(),
        real_world_references: realWorldRefs,
        dependencies,
    };

    store.saveSceneEnvironment(env);
    ctx.info(`[generateSceneEnvironment] ${sceneId} 环境图提示词完成（${dependencies.length} 个依赖）`);
    return env;
}

/**
 * 从提示词中提取现实案例参照。
 * 简单实现：正则匹配 "参考 X" 或 "inspired by X" 后的内容。
 */
function extractRealWorldReferences(prompt: string): string[] {
    const refs = new Set<string>();

    // 中文：参考xxx
    const zhPattern = /参考([^\n,.，。]+)/g;
    for (const match of prompt.matchAll(zhPattern)) {
        const ref = match[1].trim().replace(/[，。、]/g, "");
        if (ref && ref.length < 50) refs.add(ref);
    }

    // 英文：inspired by xxx
    const enPattern = /inspired by ([^\n,]+(?:and [^\n,]+)?)/gi;
    for (const match of prompt.matchAll(enPattern)) {
        const ref = match[1].trim();
        if (ref && ref.length < 100) refs.add(ref);
    }

    return Array.from(refs).slice(0, 2);
}