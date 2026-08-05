// nodes/render-videos/renderer.ts
import { getSmartVideo } from "$libs/model/index.js";
import { PrjDB } from "$libs/project/controllers/drizzle/index.js";
import { throwUnprcessable } from "$libs/utils/err.js";
import type { IRunnerContext } from "$types/blueprint/context.js";
import { experimental_generateVideo as generateVideo } from "ai";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { VideoRenderStorage } from "./storage.js";
import type { VideoGenParams, VideoRenderResult } from "./types.js";

const VIDS_SUBDIR = "vids";
const MAX_REFERENCE_IMAGES = 9; // Seedance 全能参考图上限

let referenceCache: Map<string, Uint8Array> | null = null;

export function initVideoReferenceCache(): void { referenceCache = new Map(); }
export function clearVideoReferenceCache(): void { referenceCache = null; }

function deriveFileStem(segId: string, seed: number): string {
    const hash = createHash("sha256").update(`${segId}|${seed}`).digest("hex").slice(0, 12);
    return `vid_${hash}`;
}

/**
 * 把语义分辨率标签（480p / 720p / 1080p / 4k）转为 AI SDK 要求的 16:9 像素规格。
 * 16:9 约定（与 config:aspectRatio 9:16 不冲突——这是显示画幅比例，不是像素分辨率）。
 */
function resolveResolution(spec: string): `${number}x${number}` | undefined {
    switch (spec) {
        case "480p": return "854x480";
        case "720p": return "1280x720";
        case "1080p": return "1920x1080";
        case "4k": return "3840x2160";
        default: return undefined;
    }
}

/**
 * 在编排前由 caller 校验每个 segment 的 referenceImages 是否都有 file_path。
 * 返回缺失依赖列表；若非空，**放弃整个 segment 的渲染**，由 caller 级联取消下游。
 */
export function validateSegmentDependencies(
    params: VideoGenParams,
): { ready: boolean; missing: string[] } {
    const missing: string[] = [];
    for (const r of params.referenceImages) {
        if (!r.file_path) {
            missing.push(r.ref_id);
        }
    }
    return { ready: missing.length === 0, missing };
}

export function buildVideoParams(
    ctx: IRunnerContext,
    segmentId: string,
    prompt: string,
    refImages: Array<{ ref_id: string; entity_name: string; role: string }>,
    durationSeconds: number,
): VideoGenParams {
    const storage = new VideoRenderStorage(ctx);
    const prjdb = PrjDB.ensure(ctx.prj);

    // 与 design-shots / plan-video-segments / render-videos/index.ts 同源：从 PrjDB config:* 读；
    // parse-script/index.ts 已默认落，本处兜底同值。
    const aspectRatio = prjdb.get<string>("config:aspectRatio") ?? "9:16";
    const frameRate = parseInt(prjdb.get<string>("config:frameRate") ?? "24", 10);
    const seed = storage.getOrCreateSeed(segmentId);

    // Seedance 上限 9 张图；超限时优先保留：环境图(1) + 主要角色图(<=8)
    const truncated = truncateReferences(refImages, MAX_REFERENCE_IMAGES);
    if (truncated.omitted.length > 0) {
        ctx.warn(
            `[buildVideoParams] ${segmentId} 参考图 ${refImages.length} 张超过 ${MAX_REFERENCE_IMAGES} 上限，`
            + `省略：${truncated.omitted.map(o => o.entity_name).join("、")}`,
        );
    }

    const referenceImages = truncated.kept.map(r => ({
        ref_id: r.ref_id,
        entity_name: r.entity_name,
        role: r.role,
        file_path: storage.getRenderResult(r.ref_id)?.file_path ?? null,
    }));

    return {
        segment_id: segmentId,
        prompt,
        referenceImages,
        duration_seconds: Math.min(15, durationSeconds),
        aspect_ratio: aspectRatio,
        frame_rate: Number.isFinite(frameRate) && frameRate > 0 ? frameRate : 24,
        seed,
    };
}

/**
 * 截断参考图：保留环境图（ref_id 以 env: 开头）+ 其余按顺序。
 */
function truncateReferences(
    refs: Array<{ ref_id: string; entity_name: string; role: string }>,
    max: number,
): { kept: typeof refs; omitted: typeof refs } {
    if (refs.length <= max) return { kept: refs, omitted: [] };
    const env = refs.find(r => r.ref_id.startsWith("env:"));
    const envIdx = env ? refs.indexOf(env) : -1;
    const others = refs.filter((_, i) => i !== envIdx);
    const kept: typeof refs = env ? [env] : [];
    const roomLeft = max - kept.length;
    kept.push(...others.slice(0, roomLeft));
    const omitted = refs.filter(r => !kept.includes(r));
    return { kept, omitted };
}

async function loadReferenceBytes(
    ctx: IRunnerContext,
    refs: VideoGenParams["referenceImages"],
): Promise<Uint8Array[]> {
    const out: Uint8Array[] = [];
    for (const r of refs) {
        if (!r.file_path) {
            throwUnprcessable(
                `视频段参考图 "${r.ref_id}"（${r.entity_name}）尚无渲染结果`,
            );
        }
        const abs = path.isAbsolute(r.file_path) ? r.file_path : path.join(ctx.prj.path, r.file_path);
        if (referenceCache?.has(abs)) {
            out.push(referenceCache.get(abs) as Uint8Array);
            continue;
        }
        const buf = await readFile(abs);
        if (referenceCache) referenceCache.set(abs, buf);
        out.push(buf);
    }
    return out;
}

/**
 * 调用视频生成 API。
 *
 * 输入形态：
 *   - prompt 字段：纯文本（自然语言导演指令 + 时间戳 + 对白 + 负面约束）
 *   - inputReferences 字段：[{ data: Uint8Array, mediaType: "image/jpeg" }, ...]
 *     （全能参考模式；不走 frameImages 的首尾帧路径）
 *
 * 全能参考 vs 首尾帧的关键区别：本工作流是 reference-to-video，
 * 图像提供"外观锚点"，而非"首帧/末帧"。
 *
 * 分辨率：来自 config:resolution（480p/720p/1080p/4k），映射成 16:9 像素规格传 AI SDK。
 * 帧率：来自 config:frameRate（默认 24）。无效值兜底 24。
 */
export async function callVideoAPI(
    ctx: IRunnerContext,
    params: VideoGenParams,
): Promise<string | null> {
    try {
        const bytes = await loadReferenceBytes(ctx, params.referenceImages);

        const inputReferences = bytes.length > 0
            ? bytes.map(b => ({ data: b, mediaType: "image/jpeg" as const }))
            : undefined;

        // 读分辨率（语义值 → 像素规格）
        const resolutionSpec = PrjDB.ensure(ctx.prj).get<string>("config:resolution") ?? "480p";
        const resolution = resolveResolution(resolutionSpec);

        const { video } = await generateVideo({
            model: getSmartVideo(undefined, ctx),
            prompt: params.prompt,                  // 纯文本（全能参考不走图混入 prompt）
            inputReferences,                        // 多参考图全部走这条路径
            duration: params.duration_seconds,
            aspectRatio: params.aspect_ratio as `${number}:${number}`,
            resolution,                             // 例 "1280x720"；未知 spec 时 undefined
            fps: params.frame_rate,
            seed: params.seed,
        });

        const stem = deriveFileStem(params.segment_id, params.seed);
        const filename = `${stem}.mp4`;
        const absDir = path.join(ctx.prj.path, VIDS_SUBDIR);
        const absPath = path.join(absDir, filename);
        const relPath = path.posix.join(VIDS_SUBDIR, filename);

        await mkdir(absDir, { recursive: true });
        await writeFile(absPath, video.uint8Array);

        ctx.info(
            `[callVideoAPI] ${params.segment_id} → ${relPath} `
            + `(${video.uint8Array.length} bytes; `
            + `res=${resolutionSpec}${resolution ? `(${resolution})` : ""}, `
            + `fps=${params.frame_rate})`,
        );
        return relPath;
    } catch (err) {
        ctx.warn(`[callVideoAPI] ${params.segment_id} 渲染失败：${(err as Error).message ?? err}`);
        return null;
    }
}

/**
 * 渲染单个 segment。返回 null = 放弃（依赖缺失或 API 失败）。
 */
export async function renderSegment(
    ctx: IRunnerContext,
    segmentId: string,
    prompt: string,
    refImages: Array<{ ref_id: string; entity_name: string; role: string }>,
    durationSeconds: number,
): Promise<VideoRenderResult | null> {
    const storage = new VideoRenderStorage(ctx);
    const params = buildVideoParams(ctx, segmentId, prompt, refImages, durationSeconds);

    // ===== 依赖校验：缺失即放弃 =====
    const validation = validateSegmentDependencies(params);
    if (!validation.ready) {
        ctx.warn(
            `[renderSegment] ${segmentId} 依赖未渲染，放弃：`
            + `缺失 ${validation.missing.join("、")}；`
            + `其下游依赖者也将被级联取消。`,
        );
        // 落盘 params（含缺失依赖信息）便于排查，但不写 result
        storage.saveRenderParams(segmentId, params);
        return null;
    }

    storage.saveRenderParams(segmentId, params);

    const relPath = await callVideoAPI(ctx, params);
    if (!relPath) {
        ctx.warn(`[renderSegment] ${segmentId} 渲染失败，参数已备好待重试`);
        return null;
    }

    return {
        segment_id: segmentId,
        file_path: relPath,
        duration_seconds: params.duration_seconds,
        rendered_at: Date.now(),
        prompt_used: params.prompt,
        seed: params.seed,
    };
}