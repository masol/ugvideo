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

export async function renderOne(
    ctx: IRunnerContext,
    params: {
        taskId: string;
        layoutText: string;
        size: AdSize;
        style: AdStyle;
        sceneIdx: number;
        productImages: string[];
    },
): Promise<RenderResult | null> {
    const store = new Storage(ctx);
    const prompt = extractImagePrompt(params.layoutText);
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

        ctx.info(`[render-ad] ${params.taskId} → ${relPath} (${image.uint8Array.length} bytes)`);
        return {
            task_id: params.taskId,
            file_path: relPath,
            size_key: params.size.key,
            style: params.style,
            seed,
            rendered_at: Date.now(),
            prompt_used: prompt,
        };
    } catch (err) {
        ctx.warn(`[render-ad] ${params.taskId} 渲染失败：${(err as Error).message ?? err}`);
        return null;
    }
}