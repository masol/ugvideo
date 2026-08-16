/**
 * weaver · meta · 主 DAG 拓扑层级分组
 *
 * 一代 = 同一拓扑深度的所有节点。
 * 深度：从源节点（无入边）= 0，逐层 max(父深度) + 1。
 */

import type { DirectedGraph } from "graphology";
import { topoOrder } from "../../graph/graph-ops.js";

export function topologicalLevels(g: DirectedGraph): string[][] {
    if (g.order === 0) return [];

    const order = topoOrder(g);
    if (order.length === 0) {
        // 有环降级：每节点一代
        const fallback: string[][] = [];
        g.forEachNode((id) => fallback.push([id]));
        return fallback;
    }

    const depth = new Map<string, number>();
    for (const u of order) {
        let d = 0;
        g.forEachInNeighbor(u, (p) => {
            const pd = depth.get(p);
            if (pd != null) d = Math.max(d, pd + 1);
        });
        depth.set(u, d);
    }

    const maxD = Math.max(0, ...[...depth.values()]);
    const buckets: string[][] = Array.from({ length: maxD + 1 }, () => []);
    for (const [node, d] of depth) buckets[d].push(node);
    return buckets.filter((b) => b.length > 0);
}