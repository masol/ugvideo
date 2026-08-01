// nodes/render-images/render-dag.ts
import { DirectedGraph } from "graphology";
import { forEachTopologicalGeneration, hasCycle } from "graphology-dag";
import type { RenderTaskDescriptor } from "../generate-reference-images/types.js";

/**
 * 渲染依赖计划。
 * - generations：按拓扑代排序的任务 id 二维数组。同一代内互不依赖，可并行；
 *   代与代之间串行（后代依赖前代已产出的参考图 file_path）。
 * - cyclic：true 表示检测到循环依赖，已降级为"全部塞进单代"（互不阻塞地并行执行）。
 */
export interface RenderPlan {
    generations: string[][];
    cyclic: boolean;
}

/**
 * 依据 reference_images[].ref_id 构建渲染依赖图。
 *
 * 边方向：依赖（参考图）→ 引用者（消费该参考图的任务）。
 * 因此拓扑排序把"被依赖的参考图"排在前面，先出图。
 *
 * 仅在 ref_id 对应一个真实渲染任务时连边；ref_id 指向非任务
 * （如内联描述实体、被 cutoff 裁掉的参考图）时跳过——那类引用
 * 无法由渲染满足，不构成执行依赖。
 */
export function buildRenderGraph(tasks: RenderTaskDescriptor[]): DirectedGraph {
    const g = new DirectedGraph();
    const ids = new Set(tasks.map(t => t.id));

    for (const t of tasks) {
        if (!g.hasNode(t.id)) g.addNode(t.id);
    }

    for (const t of tasks) {
        for (const ref of t.reference_images ?? []) {
            if (ref.ref_id === t.id) continue;      // 自引用
            if (!ids.has(ref.ref_id)) continue;     // 依赖不是渲染任务，跳过
            if (!g.hasEdge(ref.ref_id, t.id)) {
                g.addDirectedEdge(ref.ref_id, t.id); // dependency -> dependent
            }
        }
    }

    return g;
}

/**
 * 生成按代分批的执行计划。
 * 检测到环时降级：所有任务放进单一代（并行执行，不再强制顺序），
 * 并标记 cyclic=true 供调用方告警。图构建保证无环时才走拓扑分代。
 */
export function planRenderOrder(tasks: RenderTaskDescriptor[]): RenderPlan {
    if (tasks.length === 0) return { generations: [], cyclic: false };

    const g = buildRenderGraph(tasks);

    if (hasCycle(g)) {
        return { generations: [tasks.map(t => t.id)], cyclic: true };
    }

    const generations: string[][] = [];
    forEachTopologicalGeneration(g, (generation) => {
        generations.push(generation);
    });

    return { generations, cyclic: false };
}