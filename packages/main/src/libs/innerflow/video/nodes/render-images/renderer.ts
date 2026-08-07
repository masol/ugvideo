// nodes/render-images/renderer.ts
import { getSmartImage } from "$libs/model/index.js";
import { throwUnprcessable } from "$libs/utils/err.js";
import type { IRunnerContext } from "$types/blueprint/context.js";
import { generateImage } from "ai";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { RefImgStorage } from "../generate-reference-images/storage.js";
import type { RenderTaskDescriptor } from "../generate-reference-images/types.js";
import { RenderStorage } from "./storage.js";
import type { ImageGenParams, RenderResult } from "./types.js";

/** 全能参考图统一尺寸：16:9 2K（2048×1152）。 */
const REFERENCE_SIZE_2K_16_9 = "2048x1152";

/** 输出图像子目录（相对 prj.path） */
const IMAGES_SUBDIR = "imgs";

/** 调试用：只渲染一张图。true 时只跑第一个任务，后续直接跳过。 */
// const DEBUG_onlyOneCall = false;

/**
 * 参考图读取缓存（绝对路径 → 字节流）。
 * 生命周期由节点入口管理：进入 renderImages 时 init，退出时 clear。
 * 同一文件在一次节点运行内只从磁盘读一次。
 *
 * 安全性：单次运行内，每个参考图文件先被渲染（写一次），后被多个 dependent 读取，
 * 不存在"读后又写同一文件"，故缓存内容在运行内稳定。
 */
let referenceCache: Map<string, Uint8Array> | null = null;

export function initReferenceCache(): void {
    referenceCache = new Map();
}

export function clearReferenceCache(): void {
    referenceCache = null;
}

/**
 * 根据 task id + seed 生成稳定、跨 OS 安全的文件名（不含扩展名）。
 *
 * - 同一 (taskId, seed) 永远得到同一文件名，便于可复现与断点续跑；
 * - SHA-256 截前 12 位十六进制，碰撞概率 ≈ 1/2^48；
 * - 16 进制仅含 [0-9a-f]，天然跨 OS 安全。
 */
function deriveFileStem(task: RenderTaskDescriptor, seed: number): string {
    const kindPrefix = (() => {
        switch (task.type) {
            case "entity_refsheet": return "entity";
            case "scene_environment": return "env";
            case "uniform_turnaround": return "uniform";
            case "group_photo": return "group";
            default: return "ref";
        }
    })();
    const hash = createHash("sha256")
        .update(`${task.id}|${seed}`)
        .digest("hex")
        .slice(0, 12);
    return `${kindPrefix}_${hash}`;
}

/**
 * 读取单个参考图文件（带缓存）。
 * 读取失败直接抛出——由调用方决定如何处理（不在此处静默吞掉）。
 */
async function readReferenceFile(ctx: IRunnerContext, absPath: string): Promise<Uint8Array> {
    if (referenceCache?.has(absPath)) {
        return referenceCache.get(absPath) as Uint8Array;
    }
    const buf = await readFile(absPath);
    if (referenceCache) referenceCache.set(absPath, buf);
    return buf;
}

/**
 * 异步加载全部参考图为 Uint8Array[]，顺序与 referenceImages 一致。
 *
 * 失败即抛出（不静默跳过）：
 * - file_path 为 null：上游依赖未渲染成功，缺少一致性锚点；
 * - readFile 抛错：文件缺失或 IO 错误。
 *
 * 抛出后由 callImageAPI 捕获，使本任务干净失败并可重试，而非生成缺失参考的错误图。
 */
async function loadReferenceBytes(
    ctx: IRunnerContext,
    refImages: ImageGenParams["referenceImages"],
): Promise<Uint8Array[]> {
    const prjRoot = ctx.prj.path;
    const out: Uint8Array[] = [];

    for (const r of refImages) {
        if (!r.file_path) {
            throwUnprcessable(
                `参考图 "${r.ref_id}"（${r.entity_name}）尚无渲染结果（file_path 为空），`
                + `说明其上游渲染失败，无法保证一致性`,
            );
        }
        const abs = path.isAbsolute(r.file_path) ? r.file_path : path.join(prjRoot, r.file_path);
        try {
            out.push(await readReferenceFile(ctx, abs));
        } catch (err) {
            throwUnprcessable(`读取参考图失败：${abs}（${(err as Error).message}）`);
        }
    }
    return out;
}

/**
 * 准备 generateImage 调用参数（纯内存组装，不做 IO）。
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

/**
 * 调用图像生成 API 渲染单个任务。
 *
 * 流程：
 *   1. 异步加载参考图字节流（缺失即抛错，任务干净失败）；
 *   2. 把 prompt 包装成 { images, text } 形态传给 generateImage；
 *   3. 拿到 image.uint8Array 后落盘到 prj.path/imgs/{stem}.jpg；
 *   4. 返回相对路径。
 */
export async function callImageAPI(
    ctx: IRunnerContext,
    task: RenderTaskDescriptor,
    params: ImageGenParams,
): Promise<string | null> {
    ctx.debug(`[callImageAPI] task=${task.id} type=${task.type}`);
    ctx.debug(
        `[callImageAPI] size=${params.size} seed=${params.seed} `
        + `refs=${params.referenceImages.length} n=${params.n}`,
    );
    ctx.debug(`[callImageAPI] prompt (first 300 chars):\n${params.prompt.slice(0, 300)}${params.prompt.length > 300 ? "\n..." : ""}`);

    try {
        const bytes = await loadReferenceBytes(ctx, params.referenceImages);

        const promptInput = bytes.length > 0
            ? { images: bytes, text: params.prompt }
            : params.prompt;

        const { image } = await generateImage({
            model: getSmartImage(undefined, ctx),
            prompt: promptInput,
            size: params.size as `${number}x${number}`,
            seed: params.seed,
            n: params.n,
        });

        // 落盘
        const stem = deriveFileStem(task, params.seed);
        const filename = `${stem}.jpg`;
        const absDir = path.join(ctx.prj.path, IMAGES_SUBDIR);
        const absPath = path.join(absDir, filename);
        const relPath = path.join(IMAGES_SUBDIR, filename);

        await mkdir(absDir, { recursive: true });
        await writeFile(absPath, image.uint8Array);

        ctx.info(`[callImageAPI] ${task.id} → ${relPath} (${image.uint8Array.length} bytes)`);
        return relPath;
    } catch (err) {
        ctx.warn(`[callImageAPI] ${task.id} 渲染失败：${(err as Error).message ?? err}`);
        return null;
    }
}

/**
 * 构建结构化提示词（权重前置 + 全局一致性约束）。
 *
 * 模块化结构：
 *   ① 参考图使用说明（最高优先级，含每张参考图的强指令）
 *   ② 人物本体与画面描述（task.prompt 原文）
 *   ③ 全局一致性约束（含服装优先级声明）
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

    // ① 参考声明前置
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

    // ③ 全局一致性约束
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
    // 调试开关：只跑一张图就跑完流程
    // if (DEBUG_onlyOneCall) {
    //     ctx.warn(`[renderTask] onlyOneCall=true，已跳过 ${task.id}`);
    //     return null;
    // }
    // DEBUG_onlyOneCall = true;

    const renderStore = new RenderStorage(ctx);
    const params = buildGenerateImageParams(ctx, task);
    renderStore.saveRenderParams(task.id, params);

    const relPath = await callImageAPI(ctx, task, params);
    if (!relPath) {
        ctx.warn(`[renderTask] ${task.id} 渲染失败，参数已备好待重试`);
        return null;
    }

    return {
        id: task.id,
        file_path: relPath,
        rendered_at: Date.now(),
        prompt_used: params.prompt,
        seed: params.seed,
    };
}