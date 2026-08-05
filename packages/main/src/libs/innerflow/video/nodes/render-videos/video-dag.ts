// nodes/render-videos/video-dag.ts
import { DirectedGraph } from "graphology";
import { forEachTopologicalGeneration, hasCycle } from "graphology-dag";
import type { VideoGenParams } from "./types.js";

/**
 * 视频段之间天然无强依赖（同一场景段内已包含完整参考图清单）。
 * 但仍构建图以保留未来扩展（如跨场景参考图）。
 */
export interface VideoPlan {
    generations: string[][];
    cyclic: boolean;
}

/**
 * DAG 入参的最小类型：DAG 只关心 referenceImages[].ref_id 的有向边，
 * 不需要 file_path / prompt / duration / aspect_ratio / seed 等字段。
 * 由此 VideoGenParams（多带 file_path）天然是此类型的 supertype，
 * 调用方也可直接传入裁剪后的窄类型，避免冗余字段传染。
 */
export interface SegmentDagNode {
    segment_id: string;
    referenceImages: Array<{ ref_id: string }>;
}

export function buildSegmentGraph(segments: ReadonlyArray<SegmentDagNode>): DirectedGraph {
    const g = new DirectedGraph();
    const ids = new Set(segments.map(s => s.segment_id));
    for (const s of segments) {
        if (!g.hasNode(s.segment_id)) g.addNode(s.segment_id);
    }
    for (const s of segments) {
        for (const ref of s.referenceImages) {
            if (ref.ref_id === s.segment_id) continue;
            if (!ids.has(ref.ref_id)) continue;
            if (!g.hasEdge(ref.ref_id, s.segment_id)) {
                g.addDirectedEdge(ref.ref_id, s.segment_id);
            }
        }
    }
    return g;
}

export function planSegmentOrder(
    segments: ReadonlyArray<SegmentDagNode>,
): VideoPlan {
    if (segments.length === 0) return { generations: [], cyclic: false };
    const g = buildSegmentGraph(segments);
    if (hasCycle(g)) {
        return { generations: [segments.map(s => s.segment_id)], cyclic: true };
    }
    const generations: string[][] = [];
    forEachTopologicalGeneration(g, (gen) => generations.push(gen));
    return { generations, cyclic: false };
}

/**
 * 类型兼容性说明（供代码阅读时不报错式困惑）：
 *   - `VideoGenParams` 是 `SegmentDagNode` 的 supertype（结构兼容）
 *   - 反之 `SegmentDagNode` ⊆ `VideoGenParams`，所以可用窄类型喂 DAG
 *   - 关系由 TS 鸭子类型自动成立，无需显式断言
 *
 * 例：
 *   const full: VideoGenParams[] = [...];        // 带 file_path
 *   const order = planSegmentOrder(full);         // OK：DAG 只读 ref_id
 */
export type { VideoGenParams };
