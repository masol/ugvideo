// nodes/render-videos/index.ts
import { PrjDB } from "$libs/project/controllers/drizzle/index.js";
import { configService } from "$libs/store/index.js";
import type { IRunnerContext } from "$types/blueprint/context.js";
import pMap from "p-map";
import { VideoSegmentStorage } from "../plan-video-segments/storage.js";
import { RenderStorage } from "../render-images/storage.js";
import {
    clearVideoReferenceCache,
    initVideoReferenceCache,
    renderSegment,
    validateSegmentDependencies,
} from "./renderer.js";
import { VideoRenderStorage } from "./storage.js";
import type { VideoGenParams, VideoRenderResult } from "./types.js";
import { planSegmentOrder } from "./video-dag.js";

export async function renderVideos(ctx: IRunnerContext): Promise<void> {
    initVideoReferenceCache();

    try {
        const store = new VideoSegmentStorage(ctx);
        const renderStore = new VideoRenderStorage(ctx);
        // 修复：图片渲染结果必须从 RenderStorage 读，不能用 VideoRenderStorage
        const imageStore = new RenderStorage(ctx);

        const allSegments = store.sceneIds().flatMap(sid => store.getAllSegments(sid));
        if (!allSegments.length) {
            ctx.info("[renderVideos] 无 video segment，跳过");
            return;
        }

        const aspectRatio = PrjDB.ensure(ctx.prj).get<string>("config:aspectRatio") ?? "9:16";

        const dagNodes = allSegments.map(seg => ({
            segment_id: seg.segment_id,
            prompt: seg.prompt,
            referenceImages: seg.reference_images.map(r => ({
                ref_id: r.ref_id,
                entity_name: r.entity_name,
                role: r.role,
            })),
            duration_seconds: parseDurationSeconds(seg.total_duration),
            aspect_ratio: aspectRatio,
            seed: 0,
        }));

        const { generations, cyclic } = planSegmentOrder(dagNodes);
        if (cyclic) ctx.warn("[renderVideos] 检测到循环依赖，降级并行");

        ctx.info(`[renderVideos] 共 ${allSegments.length} 个 segment，${generations.length} 代`);

        const byId = new Map(allSegments.map(s => [s.segment_id, s]));
        const skippedIds = new Set<string>();
        let succeeded = 0;
        let failed = 0;
        let skipped = 0;

        for (let i = 0; i < generations.length; i++) {
            const genIds = generations[i];

            const pendingIds = genIds.filter(id => !renderStore.getRenderResult(id));
            const skippedInGen: Array<{ id: string; reasons: string[] }> = [];

            for (const id of pendingIds) {
                if (skippedIds.has(id)) continue;
                const seg = byId.get(id);
                if (!seg) continue;

                // 修复：预校验时用 imageStore（RenderStorage）读图片 ref 的 file_path，
                // 而不是用 renderStore（VideoRenderStorage）——后者只存视频 segment 结果，
                // env:*、<sceneId>__<entityName>、uniform:* 这类 ref 的结果全存在图片 store 里。
                const paramStub: VideoGenParams = {
                    segment_id: seg.segment_id,
                    prompt: seg.prompt,
                    referenceImages: seg.reference_images.map(r => ({
                        ...r,
                        file_path: imageStore.getRenderResult(r.ref_id)?.file_path ?? null,
                    })),
                    duration_seconds: parseDurationSeconds(seg.total_duration),
                    aspect_ratio: aspectRatio,
                    frame_rate: parseInt(PrjDB.ensure(ctx.prj).get<string>("config:frameRate") ?? "24", 10),
                    seed: 0,
                };

                const validation = validateSegmentDependencies(paramStub);
                if (!validation.ready) {
                    skippedInGen.push({ id, reasons: validation.missing });
                }
            }

            if (skippedInGen.length > 0) {
                const skippedIdsInGen = skippedInGen.map(x => x.id);
                const downstreamOfSkipped = computeDownstream(skippedIdsInGen, dagNodes);
                downstreamOfSkipped.forEach(id => skippedIds.add(id));

                for (const sk of skippedInGen) {
                    skipped++;
                    const downstreamCount = Array.from(downstreamOfSkipped).filter(x => x !== sk.id).length;
                    ctx.warn(
                        `[renderVideos] 放弃 ${sk.id}：依赖 ${sk.reasons.join("、")} 缺失；`
                        + `其下游 ${downstreamCount} 个 segment 也将级联取消`,
                    );
                }
            }

            const runnableIds = pendingIds.filter(id => !skippedIds.has(id));
            if (runnableIds.length === 0) continue;

            ctx.info(`[renderVideos] 第 ${i + 1}/${generations.length} 代：渲染 ${runnableIds.length} 个 segment`);

            await pMap(runnableIds, async (id) => {
                const seg = byId.get(id);
                if (!seg) return;
                const result: VideoRenderResult | null = await renderSegment(
                    ctx,
                    seg.segment_id,
                    seg.prompt,
                    seg.reference_images,
                    parseDurationSeconds(seg.total_duration),
                );
                if (!result) {
                    failed++;
                    return;
                }
                renderStore.saveRenderResult(result);
                succeeded++;
                ctx.info(`[renderVideos] ${seg.segment_id} 完成：${result.file_path}`);
            }, { concurrency: configService().get("concurrency") });
        }

        ctx.info(
            `[renderVideos] 完成，成功 ${succeeded}，失败 ${failed}，放弃（含级联） ${skipped}`,
        );
    } finally {
        clearVideoReferenceCache();
    }
}

function computeDownstream(
    seedIds: string[],
    allNodes: Array<{ segment_id: string; referenceImages: Array<{ ref_id: string }> }>,
): Set<string> {
    const seedSet = new Set(seedIds);
    const downstream = new Set<string>();

    for (const p of allNodes) {
        for (const ref of p.referenceImages) {
            if (seedSet.has(ref.ref_id)) {
                downstream.add(p.segment_id);
                break;
            }
        }
    }

    return downstream;
}

function parseDurationSeconds(s: string): number {
    const m = s.match(/(\d+)\s*秒/);
    return m ? parseInt(m[1], 10) : 15;
}