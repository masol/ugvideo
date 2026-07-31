// nodes/render-images/renderer.ts
import type { IRunnerContext } from "$types/blueprint/context.js";
import { RefImgStorage } from "../generate-reference-images/storage.js";
import type { RenderTaskDescriptor } from "../generate-reference-images/types.js";
import type { RenderResult } from "./types.js";

/**
 * 调用图像生成 API 渲染单个任务。
 *
 * 用户实现：替换内部 API 调用为真实服务（Stable Diffusion / Midjourney / DALL-E 等）。
 */
export async function callImageAPI(
    ctx: IRunnerContext,
    task: RenderTaskDescriptor,
    structuredPrompt: string,
): Promise<string | null> {
    ctx.debug(`[callImageAPI] task=${task.id} type=${task.type}`);
    ctx.debug(`[callImageAPI] prompt (first 300 chars):\n${structuredPrompt.slice(0, 300)}${structuredPrompt.length > 300 ? "\n..." : ""}`);

    if (task.asset_info) {
        ctx.debug(`[callImageAPI] asset: name=${task.asset_info.entity_name} kind=${task.asset_info.kind} layout=${task.asset_info.layout}`);
    }
    if (task.scene_info) {
        ctx.debug(`[callImageAPI] scene: ${task.scene_info.scene_id}, inline entities=${task.scene_info.inline_entities.length}`);
    }

    // TODO: 用户实现文生图 API 调用
    // 示例：
    // const response = await fetch("https://api.example.com/generate", {
    //     method: "POST",
    //     body: JSON.stringify({ prompt: structuredPrompt, width: 1920, height: 1080 }),
    // });
    // const data = await response.json();
    // return data.file_path ?? null;

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
        const isPreviousSceneRef = ref.role.includes("previous_scene");

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
 * 渲染单个任务（含结构化提示词拼接 + API 调用）。
 */
export async function renderTask(
    ctx: IRunnerContext,
    task: RenderTaskDescriptor,
): Promise<RenderResult | null> {
    const structuredPrompt = buildStructuredPrompt(ctx, task);

    // 调试输出：完整提示词
    ctx.error(`[renderTask] 任务 ${task.id} 的完整提示词：\n\n${structuredPrompt}\n`);

    const filePath = await callImageAPI(ctx, task, structuredPrompt);
    if (!filePath) {
        ctx.warn(`[renderTask] ${task.id} 渲染失败`);
        return null;
    }

    return {
        id: task.id,
        file_path: filePath,
        rendered_at: Date.now(),
        prompt_used: structuredPrompt,
    };
}