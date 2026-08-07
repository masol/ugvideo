// nodes/render-videos/renderer.ts
import { getSmartVideo } from "$libs/model/index.js";
import { PrjDB } from "$libs/project/controllers/drizzle/index.js";
import { throwUnprcessable } from "$libs/utils/err.js";
import type { IRunnerContext } from "$types/blueprint/context.js";
import { experimental_generateVideo as generateVideo } from "ai";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { RenderStorage } from "../render-images/storage.js";
import { VideoRenderStorage } from "./storage.js";
import type { VideoGenParams, VideoRenderResult } from "./types.js";

const VIDS_SUBDIR = "vids";
const MAX_REFERENCE_IMAGES = 50; // Seedance 全能参考图上限

let referenceCache: Map<string, Uint8Array> | null = null;

export function initVideoReferenceCache(): void { referenceCache = new Map(); }
export function clearVideoReferenceCache(): void { referenceCache = null; }

function deriveFileStem(segId: string, seed: number): string {
    const hash = createHash("sha256").update(`${segId}|${seed}`).digest("hex").slice(0, 12);
    return `vid_${hash}`;
}

function resolveResolution(spec: string): `${number}x${number}` | undefined {
    return spec as `${number}x${number}`;
    // switch (spec) {
    //     case "480p": return "854x480";
    //     case "720p": return "1280x720";
    //     case "1080p": return "1920x1080";
    //     case "4k": return "3840x2160";
    //     default: return undefined;
    // }
}

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
    // 修复：用两个不同的 storage：
    //   - VideoRenderStorage：管理视频 segment 自身的 seed/params/result
    //   - RenderStorage：管理图片参考图的渲染结果（env:<sceneId>、<sceneId>__<entityName>、uniform:<name>）
    // 之前用错 storage 导致所有图片 ref 的 file_path 永远为 null。
    const videoStore = new VideoRenderStorage(ctx);
    const imageStore = new RenderStorage(ctx);
    const prjdb = PrjDB.ensure(ctx.prj);

    const aspectRatio = prjdb.get<string>("config:aspectRatio") ?? "9:16";
    const frameRate = parseInt(prjdb.get<string>("config:frameRate") ?? "24", 10);
    const seed = videoStore.getOrCreateSeed(segmentId);

    const truncated = truncateReferences(refImages, MAX_REFERENCE_IMAGES);
    if (truncated.omitted.length > 0) {
        ctx.warn(
            `[buildVideoParams] ${segmentId} 参考图 ${refImages.length} 张超过 ${MAX_REFERENCE_IMAGES} 上限，`
            + `省略：${truncated.omitted.map(o => o.entity_name).join("、")}`,
        );
    }

    // 修复：从 RenderStorage 读图片渲染结果（不是从 VideoRenderStorage 读视频结果）
    const referenceImages = truncated.kept.map(r => ({
        ref_id: r.ref_id,
        entity_name: r.entity_name,
        role: r.role,
        file_path: imageStore.getRenderResult(r.ref_id)?.file_path ?? null,
    }));

    return {
        segment_id: segmentId,
        prompt,
        referenceImages,
        duration_seconds: durationSeconds,
        aspect_ratio: aspectRatio,
        frame_rate: Number.isFinite(frameRate) && frameRate > 0 ? frameRate : 24,
        seed,
    };
}

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

export async function callVideoAPI(
    ctx: IRunnerContext,
    params: VideoGenParams,
): Promise<string | null> {
    try {
        const bytes = await loadReferenceBytes(ctx, params.referenceImages);

        const inputReferences = bytes.length > 0
            ? bytes.map(b => ({ data: b, mediaType: "image/jpeg" as const }))
            : undefined;

        const resolutionSpec = PrjDB.ensure(ctx.prj).get<string>("config:resolution") ?? "480p";
        const resolution = resolveResolution(resolutionSpec);

        const { video } = await generateVideo({
            model: getSmartVideo(undefined, ctx),
            prompt: params.prompt,
            inputReferences,
            duration: params.duration_seconds,
            aspectRatio: params.aspect_ratio as `${number}:${number}`,
            resolution,
            fps: params.frame_rate,
            seed: params.seed,
        });

        const stem = deriveFileStem(params.segment_id, params.seed);
        const filename = `${stem}.mp4`;
        const absDir = path.join(ctx.prj.path, VIDS_SUBDIR);
        const absPath = path.join(absDir, filename);
        const relPath = path.join(VIDS_SUBDIR, filename);

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

export async function renderSegment(
    ctx: IRunnerContext,
    segmentId: string,
    prompt: string,
    refImages: Array<{ ref_id: string; entity_name: string; role: string }>,
    durationSeconds: number,
): Promise<VideoRenderResult | null> {
    const videoStore = new VideoRenderStorage(ctx);
    const params = buildVideoParams(ctx, segmentId, prompt, refImages, durationSeconds);

    const validation = validateSegmentDependencies(params);
    if (!validation.ready) {
        ctx.warn(
            `[renderSegment] ${segmentId} 依赖未渲染，放弃：`
            + `缺失 ${validation.missing.join("、")}；`
            + `其下游依赖者也将被级联取消。`,
        );
        videoStore.saveRenderParams(segmentId, params);
        return null;
    }

    videoStore.saveRenderParams(segmentId, params);

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