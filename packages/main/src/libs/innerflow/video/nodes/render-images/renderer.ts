// nodes/render-images/renderer.ts
import type { IRunnerContext } from "$types/blueprint/context.js";
import { RefImgStorage } from "../generate-reference-images/storage.js";
import type { RenderTaskDescriptor } from "../generate-reference-images/types.js";
import { RenderStorage } from "./storage.js";
import type { ImageGenParams, RenderResult } from "./types.js";

/** 参考图类统一尺寸：16:9 2K（2048×1152）。可按目标模型支持尺寸调整。 */
const REFERENCE_SIZE_2K_16_9 = "2048x1152";

/** 参考图类任务（跨镜头一致性锚点，固定 16:9 2K） */
const REFERENCE_TASK_TYPES = new Set([
    "entity_refsheet",
    "scene_environment",
    "uniform_turnaround",
    "group_photo",
]);

/**
 * 按任务类别决定尺寸：
 * - 参考图类 → 固定 size（16:9 2K）
 * - 交付帧（scene_shot）→ aspectRatio（配置横纵比）
 */
function pickSizing(
    task: RenderTaskDescriptor,
    configAspectRatio: string,
): { size: string } | { aspectRatio: string } {
    if (task.type === "scene_shot") return { aspectRatio: configAspectRatio };
    if (REFERENCE_TASK_TYPES.has(task.type)) return { size: REFERENCE_SIZE_2K_16_9 };
    // 兜底：未知类别按参考图处理
    return { size: REFERENCE_SIZE_2K_16_9 };
}

/**
 * 准备 generateImage 调用参数（本函数只组装参数，不真正调用）。
 *
 * - prompt：结构化提示词（含"图1/图2…"参考声明）
 * - referenceImages：依赖参考图，顺序与 prompt 中的"图N"一致；file_path 尽力从已渲染结果解析
 * - size / aspectRatio：按任务类别二选一
 * - seed：按任务 id 持久化（复现用）
 */
export function buildGenerateImageParams(
    ctx: IRunnerContext,
    task: RenderTaskDescriptor,
): ImageGenParams {
    const renderStore = new RenderStorage(ctx);
    const prompt = buildStructuredPrompt(ctx, task);
    const seed = renderStore.getOrCreateSeed(task.id);
    const sizing = pickSizing(task, renderStore.getConfigAspectRatio());

    const referenceImages = (task.reference_images ?? []).map(r => ({
        ref_id: r.ref_id,
        entity_name: r.entity_name,
        role: r.role,
        file_path: renderStore.getRenderResult(r.ref_id)?.file_path ?? null,
    }));

    return {
        prompt,
        referenceImages,
        ...sizing,
        seed,
        n: 1,
    };
}

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
        `[callImageAPI] size=${params.size ?? "-"} aspectRatio=${params.aspectRatio ?? "-"} `
        + `seed=${params.seed} refs=${params.referenceImages.length} n=${params.n}`,
    );
    ctx.debug(`[callImageAPI] prompt (first 300 chars):\n${params.prompt.slice(0, 300)}${params.prompt.length > 300 ? "\n..." : ""}`);

    // TODO: 用户实现 —— 调用 Vercel AI SDK generateImage
    // 示例：
    // import { generateImage } from "ai";
    // const inputImages = params.referenceImages
    //     .map(r => r.file_path ?? new RenderStorage(ctx).getRenderResult(r.ref_id)?.file_path)
    //     .filter(Boolean);
    // const { image } = await generateImage({
    //     model: <由调用方指定>,
    //     prompt: params.prompt,
    //     ...(params.size ? { size: params.size } : {}),
    //     ...(params.aspectRatio ? { aspectRatio: params.aspectRatio } : {}),
    //     seed: params.seed,
    //     n: params.n,
    //     providerOptions: { /* 依赖参考图 inputImages 按 provider 约定透传 */ },
    // });
    // return await persistBase64(image.base64);

    return null;
}

/**
 * 构建结构化提示词（主体绑定与参考声明格式）。
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

    const lines: string[] = [];
    lines.push("【主体绑定与参考声明】");
    lines.push(`以下 ${refImages.length} 张参考图共同定义本次生成的视觉基准，请严格按照以下指代进行融合生成：`);
    lines.push("");

    refImages.forEach((ref, idx) => {
        const imgIndex = idx + 1;
        const bindingPrompt = buildReferenceBindingPrompt(ctx, store, ref, imgIndex);
        lines.push(bindingPrompt);
        lines.push("");
    });

    lines.push("【整体画面与一致性约束】");
    lines.push(task.prompt);
    lines.push("");
    lines.push("保持上述所有参考图中各主体的材质、光影、比例全程严格一致，不生成任何字幕与水印。");

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
            `【图${imgIndex}参考：制服款式（${uniformName}）】`,
            `提取图${imgIndex}中的制服款式。要求：严格保持图${imgIndex}中制服的廓形、材质纹理、色彩和每个构件结构，画面中所有穿着该制服的角色必须与此参考完全一致。`,
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