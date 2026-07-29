// nodes/generate-reference-images/render/dependency-graph.ts
import type { IRunnerContext } from "$types/blueprint/context.js";
import { DirectedGraph } from "graphology";
import type { RenderTask } from "../types.js";

/**
 * 构建依赖图并返回拓扑排序后的层级列表。
 * 每层内的任务可以并行执行。
 */
export function buildDependencyGraph(
    ctx: IRunnerContext,
    tasks: RenderTask[],
): RenderTask[][] {
    const graph = new DirectedGraph();

    for (const task of tasks) {
        graph.addNode(task.id, { task });
    }

    for (const task of tasks) {
        for (const depId of task.dependencies) {
            if (graph.hasNode(depId)) {
                graph.addEdge(depId, task.id);
            } else {
                ctx.warn(`[dependency-graph] 任务 ${task.id} 依赖 ${depId} 但后者不存在，跳过`);
            }
        }
    }

    const layers: RenderTask[][] = [];
    const inDegree = new Map<string, number>();
    const visited = new Set<string>();

    for (const nodeId of graph.nodes()) {
        inDegree.set(nodeId, graph.inDegree(nodeId));
    }

    while (visited.size < graph.order) {
        const currentLayer: RenderTask[] = [];

        for (const nodeId of graph.nodes()) {
            if (visited.has(nodeId)) continue;
            if ((inDegree.get(nodeId) ?? 0) === 0) {
                const task = graph.getNodeAttribute(nodeId, "task") as RenderTask;
                currentLayer.push(task);
                visited.add(nodeId);
            }
        }

        if (currentLayer.length === 0) {
            ctx.warn(`[dependency-graph] 检测到循环依赖或孤立节点，剩余 ${graph.order - visited.size} 个`);
            break;
        }

        layers.push(currentLayer);

        for (const task of currentLayer) {
            for (const neighbor of graph.outNeighbors(task.id)) {
                const current = inDegree.get(neighbor) ?? 0;
                inDegree.set(neighbor, current - 1);
            }
        }
    }

    ctx.info(`[dependency-graph] 拓扑排序完成，共 ${layers.length} 层`);
    return layers;
}