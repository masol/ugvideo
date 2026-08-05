// nodes/render-videos/index.ts
import { PrjDB } from "$libs/project/controllers/drizzle/index.js";
import type { IRunnerContext } from "$types/blueprint/context.js";
import pMap from "p-map";
import { VideoSegmentStorage } from "../plan-video-segments/storage.js";
import {
    clearVideoReferenceCache,
    initVideoReferenceCache,
    renderSegment,
    validateSegmentDependencies,
} from "./renderer.js";
import { VideoRenderStorage } from "./storage.js";
import type { VideoGenParams, VideoRenderResult } from "./types.js";
import { planSegmentOrder } from "./video-dag.js";

const MAX_CONCURRENT_VIDEO = 4;

/**
 * 渲染所有 video segment。
 *
 * 依赖级联取消规则：
 * - 渲染前对每个 segment 做依赖校验（file_path 是否齐全）
 * - 缺失依赖 → 放弃该 segment 渲染
 * - 放弃的 segment 其下游也一并标记 skip（即使下游依赖本身齐全）
 * - 日志明确报告"因 X 缺失，放弃 Y 及其 N 个下游"
 */
export async function renderVideos(ctx: IRunnerContext): Promise<void> {
    initVideoReferenceCache();

    try {
        const store = new VideoSegmentStorage(ctx);
        const renderStore = new VideoRenderStorage(ctx);

        const allSegments = store.sceneIds().flatMap(sid => store.getAllSegments(sid));
        if (!allSegments.length) {
            ctx.info("[renderVideos] 无 video segment，跳过");
            return;
        }

        // 画幅来源：与 design-shots / plan-video-segments 保持一致，从 PrjDB 的 config:aspectRatio 读取；
        // parse-script/index.ts 的 ensureDefaultConfig 已在首次启动时落盘默认 "9:16"，此处兜底为同值。
        const aspectRatio = PrjDB.ensure(ctx.prj).get<string>("config:aspectRatio") ?? "9:16";

        // DAG 拓扑排序只关心 referenceImages[].ref_id 的有向边，与 file_path 无关；
        // 喂给 planSegmentOrder 的入参裁掉 file_path 字段，避免与 VideoGenParams.required 不符。
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
        const skippedIds = new Set<string>(); // 因依赖缺失而级联跳过的 segment
        let succeeded = 0;
        let failed = 0;
        let skipped = 0;

        for (let i = 0; i < generations.length; i++) {
            const genIds = generations[i];

            // ===== 渲染前：依赖级联取消 =====
            const pendingIds = genIds.filter(id => !renderStore.getRenderResult(id));
            const skippedInGen: Array<{ id: string; reasons: string[] }> = [];

            for (const id of pendingIds) {
                if (skippedIds.has(id)) continue;
                const seg = byId.get(id);
                if (!seg) continue;

                // 自身依赖未渲染 → file_path 填实际渲染结果，缺失则 null
                // 第一个 paramStub（依赖校验用）
                const paramStub: VideoGenParams = {
                    segment_id: seg.segment_id,
                    prompt: seg.prompt,
                    referenceImages: seg.reference_images.map(r => ({
                        ...r,
                        file_path: renderStore.getRenderResult(r.ref_id)?.file_path ?? null,
                    })),
                    duration_seconds: parseDurationSeconds(seg.total_duration),
                    aspect_ratio: aspectRatio,
                    frame_rate: parseInt(PrjDB.ensure(ctx.prj).get<string>("config:frameRate") ?? "24", 10),
                    seed: 0,
                };

                // 第二个 paramStub（如有，且若 still present）同上
                const validation = validateSegmentDependencies(paramStub);
                if (!validation.ready) {
                    skippedInGen.push({ id, reasons: validation.missing });
                }
            }

            // 级联：标记本代 skip + 其所有下游（跨代）
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
                    // 注意：本代内的失败不级联（前代已渲染完）；仅记录失败
                    return;
                }
                renderStore.saveRenderResult(result);
                succeeded++;
                ctx.info(`[renderVideos] ${seg.segment_id} 完成：${result.file_path}`);
            }, { concurrency: MAX_CONCURRENT_VIDEO });
        }

        ctx.info(
            `[renderVideos] 完成，成功 ${succeeded}，失败 ${failed}，放弃（含级联） ${skipped}`,
        );
    } finally {
        clearVideoReferenceCache();
    }
}

/**
 * 给定若干 segment id，返回它们的所有下游（不包含自身）。
 * 下游 = 在 referenceImages 中 ref_id 指向本集合中任意 segment 的 segment。
 */
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