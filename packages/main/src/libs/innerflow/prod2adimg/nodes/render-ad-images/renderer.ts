// prod2adimg/nodes/render-ad-images/renderer.ts
import { getSmartImage } from "$libs/model/index.js";
import type { IRunnerContext } from "$types/blueprint/context.js";
import { generateImage } from "ai";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { Storage } from "../../storage.js";
import type { AdSize, AdStyle, RenderResult } from "../../types.js";

const IMAGES_SUBDIR = "imgs";

/**
 * 从视觉设计 NL 中抽出最终图像生成 prompt。
 * 取**最后一个** "### 图像生成提示词" 块（视觉设计通常把该块放在文末）；
 * 若完全没匹配到则回退整段文本。
 */
function extractImagePrompt(layoutText: string): string {
    const re = /^###\s*图像生成提示词\s*\n([\s\S]*?)(?=\n##\s|\n###\s|Z)/gm;
    let last: string | null = null;
    let m: RegExpExecArray | null;
    while ((m = re.exec(layoutText)) !== null) {
        last = m[1].trim();
    }
    return last ?? layoutText.trim();
}

function deriveFileStem(taskId: string, seed: number): string {
    const hash = createHash("sha256").update(`${taskId}|${seed}`).digest("hex").slice(0, 12);
    return `ad_${hash}`;
}

async function loadProductImages(ctx: IRunnerContext, relPaths: string[]): Promise<Uint8Array[]> {
    const out: Uint8Array[] = [];
    for (const rel of relPaths) {
        const abs = path.isAbsolute(rel) ? rel : path.join(ctx.prj.path, rel);
        try {
            out.push(await readFile(abs));
        } catch (err) {
            ctx.warn(`[render-ad] 产品参考图读取失败，跳过：${abs}（${(err as Error).message}）`);
        }
    }
    return out;
}

/**
 * 构建结构化提示词（参考 video 工作流的 buildStructuredPrompt 模式）。
 *
 * 模块化结构（顺序固定，参考图说明在最前）：
 *   ① 参考图使用说明（最高优先级：与下方文字冲突时一律以参考图为准）
 *   ② 用户确认的产品信息（含品牌名）
 *   ③ 视觉设计原文（task.prompt）
 *   ④ 全局一致性约束
 */
function buildStructuredPrompt(params: {
    layoutText: string;
    productImageCount: number;
    productName: string | null;
}): string {
    const lines: string[] = [];

    if (params.productImageCount > 0) {
        lines.push("【参考图使用说明（最高优先级：与下方文字描述冲突时，一律以参考图为准）】");
        lines.push(`本次生成附带 ${params.productImageCount} 张产品参考图，必须严格按以下规则执行：`);
        lines.push("");
        lines.push(`图1：产品参考图。提取该产品的：形态、尺寸比例、主材质表面处理、色彩色调、纹样铭文、品牌 logo、关键细节。`);
        lines.push("要求：");
        lines.push("- 产品在画面中的形态、材质、色彩、品牌 logo 必须与参考图完全一致");
        lines.push("- 产品在画面中的朝向/角度/局部特写/大小比例可自由调整，但整体外观不得偏离参考图");
        lines.push("- 参考图为白底产品图时尤其注意：产品必须保持其自然形态，不得被场景透视扭曲成不符合参考图的形状");
        lines.push("- 文字描述中关于产品外观的所有信息若与参考图冲突，一律以参考图为准");
        lines.push("");
    }

    if (params.productName) {
        lines.push("【用户确认的产品名称/品牌名（最高优先级：必须出现在画面文字中）】");
        lines.push(`产品名称（含品牌）：${params.productName}`);
        lines.push("要求：在画面文字区域（主标题或副标题）中必须显式出现该字面文本，由 AI 图像引擎直接在画面中生成该文字。");
        lines.push("");
    }

    lines.push("【视觉设计原文】");
    lines.push(extractImagePrompt(params.layoutText));
    lines.push("");

    lines.push("【全局一致性约束】");
    if (params.productImageCount > 0) {
        lines.push(
            "产品的外观（形态、材质、色彩、品牌 logo、细节）全程以上述产品参考图为准，"
            + "文字描述仅用于补充参考图中未清晰展示的细节与场景背景，"
            + "若文字描述与参考图冲突一律以参考图为准。",
        );
    }
    lines.push("所有文字由 AI 图像引擎直接在画面中生成，清晰可读，中文优先。不生成任何字幕、水印或额外 UI。");

    return lines.join("\n");
}

export async function renderOne(
    ctx: IRunnerContext,
    params: {
        taskId: string;
        layoutText: string;
        size: AdSize;
        style: AdStyle;
        sceneIdx: number;
        productImages: string[];
        productName: string | null;
    },
): Promise<RenderResult | null> {
    const store = new Storage(ctx);
    const prompt = buildStructuredPrompt({
        layoutText: params.layoutText,
        productImageCount: params.productImages.length,
        productName: params.productName,
    });
    store.saveRenderPrompt(params.taskId, prompt);

    const seed = store.getOrCreateSeed(params.taskId);
    const bytes = await loadProductImages(ctx, params.productImages);

    try {
        const promptInput = bytes.length > 0 ? { images: bytes, text: prompt } : prompt;

        const { image } = await generateImage({
            model: getSmartImage(undefined, ctx),
            prompt: promptInput,
            size: `${params.size.width}x${params.size.height}` as `${number}x${number}`,
            seed,
            n: 1,
        });

        const stem = deriveFileStem(params.taskId, seed);
        const filename = `${stem}.jpg`;
        const absDir = path.join(ctx.prj.path, IMAGES_SUBDIR);
        const absPath = path.join(absDir, filename);
        const relPath = path.join(IMAGES_SUBDIR, filename);

        await mkdir(absDir, { recursive: true });
        await writeFile(absPath, image.uint8Array);

        ctx.info(
            `[render-ad] ${params.taskId} → ${relPath} `
            + `(${image.uint8Array.length} bytes, ${bytes.length} 参考图${params.productName ? `, 含品牌名=${params.productName}` : ""})`,
        );
        return {
            task_id: params.taskId,
            file_path: relPath,
            size_key: params.size.key,
            style: params.style,
            seed,
            rendered_at: Date.now(),
            prompt_used: prompt,
            product_image_count: bytes.length,
        };
    } catch (err) {
        ctx.warn(`[render-ad] ${params.taskId} 渲染失败：${(err as Error).message ?? err}`);
        return null;
    }
}