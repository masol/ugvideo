// nodes/render-images/renderer.ts
import { getSmartImage } from "$libs/model/index.js";
import type { IRunnerContext } from "$types/blueprint/context.js";
import { generateImage } from 'ai';
import { writeFile } from "fs/promises";
import { RefImgStorage } from "../generate-reference-images/storage.js";
import type { RenderTaskDescriptor } from "../generate-reference-images/types.js";
import { RenderStorage } from "./storage.js";
import type { ImageGenParams, RenderResult } from "./types.js";

/** 全能参考图统一尺寸：16:9 2K（2048×1152）。可按目标模型支持尺寸调整。 */
const REFERENCE_SIZE_2K_16_9 = "2048x1152";

/**
 * 准备 generateImage 调用参数（本函数只组装参数，不真正调用）。
 *
 * 全能参考工作流：所有任务都是跨镜头一致性参考图，统一 16:9 2K。
 * 最终视频由下游 I2V/T2V 节点基于这套全能参考生成，本管线不渲染镜头帧。
 */
export function buildGenerateImageParams(
    ctx: IRunnerContext,
    task: RenderTaskDescriptor,
): ImageGenParams {
    const renderStore = new RenderStorage(ctx);
    const prompt = buildStructuredPrompt(ctx, task);
    const seed = renderStore.getOrCreateSeed(task.id);

    const referenceImages = (task.reference_images ?? []).map(r => ({
        ref_id: r.ref_id,
        entity_name: r.entity_name,
        role: r.role,
        file_path: renderStore.getRenderResult(r.ref_id)?.file_path ?? null,
    }));

    return {
        prompt,
        referenceImages,
        size: REFERENCE_SIZE_2K_16_9,
        seed,
        n: 1,
    };
}

let firstCall = false;
/**
 * 调用图像生成 API 渲染单个任务。
 *
 * 用户实现：接收已备好的 generateImage 参数（params），调用 Vercel AI SDK 的 generateImage
 * （model 由调用方指定），返回落盘后的文件路径；失败返回 null。
 *
 * params 里的 referenceImages 已按 prompt 中"图1/图2…"的顺序排列：
 * - file_path 非空 → 直接作为参考图上传
 * - file_path 为空 → 按 ref_id 从渲染结果解析（依赖任务须先渲染）
 */
export async function callImageAPI(
    ctx: IRunnerContext,
    task: RenderTaskDescriptor,
    params: ImageGenParams,
): Promise<string | null> {
    ctx.debug(`[callImageAPI] task=${task.id} type=${task.type}`);
    ctx.debug(
        `[callImageAPI] size=${params.size} `
        + `seed=${params.seed} refs=${params.referenceImages.length} n=${params.n}`,
    );
    ctx.debug(`[callImageAPI] prompt (first 300 chars):\n${params.prompt.slice(0, 300)}${params.prompt.length > 300 ? "\n..." : ""}`);

    if (!firstCall) {
        firstCall = true;
        // TODO: 用户实现 —— 调用 Vercel AI SDK generateImage
        // 示例：
        // import { generateImage } from "ai";
        const inputImages = params.referenceImages
            .map(r => r.file_path ?? new RenderStorage(ctx).getRenderResult(r.ref_id)?.file_path)
            .filter(Boolean);
        const { image } = await generateImage({
            model: getSmartImage(undefined, ctx),
            prompt: params.prompt,
            size: params.size as `${number}x${number}`,
            seed: params.seed,
            n: params.n,
            // providerOptions: { /* 依赖参考图 inputImages 按 provider 约定透传 */ },
        });

        ctx.error("inputImages=", inputImages)
        // return await persistBase64(image.base64);
        await writeFile('/home/masol/projects/unigen/cyberpunk-cat.png', image.uint8Array);
    }
    return null;
}

/**
 * 构建结构化提示词（模块化：参考声明前置 + 人物本体 + 全局一致性）。
 *
 * 采用"权重前置"的模块化结构：
 *   ① 参考图使用说明（最高优先级，含每张参考图的强指令）
 *   ② 人物本体与画面描述（task.prompt 原文）
 *   ③ 全局一致性约束（声明"参考图已明确的服装/外观以参考图为准，文字仅作补充"）
 *
 * 关键：当存在制服/角色参考图时，② 中可能重复描述了服装，与参考图潜在冲突。
 * ③ 的优先级声明确保 AI 以参考图为准、文字仅补充参考图未清晰展示的细节，
 * 从而消除"AI 脑补服装 / 文字与参考图打架"的问题。
 */
export function buildStructuredPrompt(
    ctx: IRunnerContext,
    task: RenderTaskDescriptor,
): string {
    const store = new RefImgStorage(ctx);

    const refImages = task.reference_images ?? [];
    if (refImages.length === 0) {
        return task.prompt;
    }

    const hasClothingRef = refImages.some(r =>
        detectReferenceType(r.ref_id) === "uniform"
        || r.role.includes("costume")
        || r.role.includes("制服"),
    );

    const lines: string[] = [];

    // ① 参考声明前置（权重前置）
    lines.push("【参考图使用说明（最高优先级：与下方文字描述冲突时，一律以参考图为准）】");
    lines.push(`本次生成需融合以下 ${refImages.length} 张参考图，严格按各自用途提取视觉特征：`);
    lines.push("");
    refImages.forEach((ref, idx) => {
        lines.push(buildReferenceBindingPrompt(ctx, store, ref, idx + 1));
        lines.push("");
    });

    // ② 人物本体与画面描述
    lines.push("【人物本体与画面描述】");
    lines.push(task.prompt);
    lines.push("");

    // ③ 全局一致性约束（含服装优先级声明）
    const clothingPrecedence = hasClothingRef
        ? "本角色的服装以上述制服/服装参考图为准；上方文字中的服装描述仅用于补充参考图未清晰展示的细节，若与参考图冲突一律以参考图为准。"
        : "";
    lines.push("【全局一致性约束】");
    lines.push(
        "保持上述所有参考图中各主体的面容、发型、体型、服装、材质、光影、比例全程严格一致。"
        + clothingPrecedence
        + "不生成任何字幕与水印。",
    );

    return lines.join("\n");
}

function buildReferenceBindingPrompt(
    ctx: IRunnerContext,
    store: RefImgStorage,
    ref: { ref_id: string; entity_name: string; role: string },
    imgIndex: number,
): string {
    const refType = detectReferenceType(ref.ref_id);

    if (refType === "environment") {
        return [
            `【图${imgIndex}参考：场景环境】`,
            `提取图${imgIndex}中的场景环境。要求：保持图${imgIndex}中的空间布局、固定陈设的相对位置严格一致，维持原有的光影色调分布，不新增任何无关的建筑结构或陈设元素。`,
        ].join("\n");
    }

    if (refType === "uniform") {
        const uniformName = ref.ref_id.replace(/^uniform:/, "");
        return [
            `【图${imgIndex}参考：制服（${uniformName}）】`,
            `本角色穿着图${imgIndex}中所示的完整制服。要求：将图${imgIndex}的制服款式、廓形、材质纹理、色彩以及每一处构件结构，精确套用到本角色身上，保持其原始设计不变；本角色的服装一律以图${imgIndex}为准，文字描述仅用于补充图${imgIndex}中未清晰展示的细节，若冲突以图${imgIndex}为准。`,
        ].join("\n");
    }

    if (refType === "individual") {
        const parsed = store.parseEntityRefsheetKey(ref.ref_id);
        if (!parsed) {
            return [
                `【图${imgIndex}参考：${ref.entity_name}】`,
                `提取图${imgIndex}中的${ref.entity_name}。要求：保持图${imgIndex}中的外观特征严格一致，材质与比例不变。`,
            ].join("\n");
        }

        const refsheet = store.getEntityRefsheet(parsed.sceneId, parsed.entityName);
        const asset = store.getEntityAsset(parsed.sceneId, parsed.entityName);
        const entity = store.getGlobalEntity(parsed.entityName);
        const isPreviousSceneRef = ref.role.startsWith("previous_scene_appearance_anchor");

        if (isPreviousSceneRef) {
            const kind = refsheet?.kind ?? entity?.kind ?? "character";
            if (kind === "character") {
                const isHumanoid = refsheet?.humanoid ?? entity?.humanoid ?? true;
                if (isHumanoid) {
                    return [
                        `【图${imgIndex}参考：${ref.entity_name}·前序场景外观基准】`,
                        `提取图${imgIndex}中人物的面部特征与体型。要求：严格保持图${imgIndex}中该人物的五官比例、面部骨骼结构、肤色肤质、发型发色不变——这些是跨场景不可变的身份锚点。服装可能因剧情需要有所变化，以本场景的服装描述为准。`,
                    ].join("\n");
                }
                return [
                    `【图${imgIndex}参考：${ref.entity_name}·前序场景形态基准】`,
                    `提取图${imgIndex}中生物的整体形态。要求：严格保持图${imgIndex}中该生物的身体结构、体表覆盖、比例和主色不变——这些是跨场景不可变的特征。伤痕/脏污等场景性变化以本场景描述为准。`,
                ].join("\n");
            }
            return [
                `【图${imgIndex}参考：${ref.entity_name}·前序场景外观基准】`,
                `提取图${imgIndex}中的${ref.entity_name}的基础形态。要求：保持图${imgIndex}中的整体形状、材质和色彩不变，场景性变化（磨损/位置）以本场景描述为准。`,
            ].join("\n");
        }

        const kind = refsheet?.kind ?? entity?.kind ?? asset?.kind ?? "unknown";
        return buildCurrentSceneBinding(imgIndex, ref.entity_name, kind, refsheet?.humanoid ?? false);
    }

    return [
        `【图${imgIndex}参考：${ref.entity_name}】`,
        `提取图${imgIndex}中的${ref.entity_name}。要求：保持图${imgIndex}中的外观特征严格一致，材质、光影、比例不变。`,
    ].join("\n");
}

function buildCurrentSceneBinding(imgIndex: number, entityName: string, kind: string, humanoid: boolean): string {
    if (kind === "character") {
        if (humanoid) {
            return [
                `【图${imgIndex}参考：${entityName}·人物外观】`,
                `提取图${imgIndex}中的人物外观（${entityName}）。要求：严格保持图${imgIndex}中人物的五官比例、肤色肤质、发型发色以及服饰的廓形与材质细节不变，面部神态保持原有特征，确保人物外观材质与比例严格一致。`,
            ].join("\n");
        }
        return [
            `【图${imgIndex}参考：${entityName}·生物形态】`,
            `提取图${imgIndex}中的生物形态（${entityName}）。要求：严格保持图${imgIndex}中该生物的整体轮廓、体表覆盖纹理、主色光泽和比例不变，头部特征与躯干附肢结构一致。`,
        ].join("\n");
    }
    if (kind === "prop") {
        return [
            `【图${imgIndex}参考：${entityName}·物品特征】`,
            `提取图${imgIndex}中的物品（${entityName}）。要求：保持图${imgIndex}中物品的形状、尺寸比例、主材质表面处理和色彩色调严格一致，纹样铭文与磨损痕迹不变。`,
        ].join("\n");
    }
    if (kind === "set") {
        return [
            `【图${imgIndex}参考：${entityName}·陈设结构】`,
            `提取图${imgIndex}中的陈设（${entityName}）。要求：保持图${imgIndex}中陈设的整体形态、尺寸、主材质和装饰纹样不变，空间位置与朝向一致。`,
        ].join("\n");
    }
    return [
        `【图${imgIndex}参考：${entityName}】`,
        `提取图${imgIndex}中的${entityName}。要求：保持图${imgIndex}中的外观特征严格一致。`,
    ].join("\n");
}

function detectReferenceType(refId: string): "environment" | "uniform" | "individual" | "unknown" {
    if (refId.startsWith("env:")) return "environment";
    if (refId.startsWith("uniform:")) return "uniform";
    if (refId.includes("__")) return "individual";
    return "unknown";
}

/**
 * 渲染单个任务（准备参数 → 落盘参数 → 调用 API → 组装结果）。
 */
export async function renderTask(
    ctx: IRunnerContext,
    task: RenderTaskDescriptor,
): Promise<RenderResult | null> {
    const renderStore = new RenderStorage(ctx);
    const params = buildGenerateImageParams(ctx, task);
    renderStore.saveRenderParams(task.id, params);

    const filePath = await callImageAPI(ctx, task, params);
    if (!filePath) {
        ctx.warn(`[renderTask] ${task.id} 渲染失败（或 callImageAPI 未实现），参数已备好待调用`);
        return null;
    }

    return {
        id: task.id,
        file_path: filePath,
        rendered_at: Date.now(),
        prompt_used: params.prompt,
        seed: params.seed,
    };
}