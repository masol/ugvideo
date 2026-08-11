/**
 * weaver · 纯图算法
 *
 * 提供拓扑序、关键路径、初始/终端节点、祖先/后代等查询。
 * 不依赖任何业务状态——纯函数。
 */

import type { DirectedGraph } from 'graphology';
import { topologicalSort } from 'graphology-dag';

/** 拓扑序 */
export function topoOrder(g: DirectedGraph): string[] {
    if (g.order === 0) return [];
    try {
        return topologicalSort(g);
    } catch {
        // 有环时返回空（调用方应已校验）
        return [];
    }
}

/** 初始节点（无入边） */
export function initialNodes(g: DirectedGraph): string[] {
    const out: string[] = [];
    g.forEachNode((id) => {
        if (g.inDegree(id) === 0) out.push(id);
    });
    return out;
}

/** 终端节点（无出边） */
export function terminalNodes(g: DirectedGraph): string[] {
    const out: string[] = [];
    g.forEachNode((id) => {
        if (g.outDegree(id) === 0) out.push(id);
    });
    return out;
}

/** 某节点的全部祖先 */
export function ancestorsOf(g: DirectedGraph, nodeId: string): Set<string> {
    const acc = new Set<string>();
    const queue = [nodeId];
    while (queue.length > 0) {
        const cur = queue.shift()!;
        g.forEachInNeighbor(cur, (nb) => {
            if (!acc.has(nb)) {
                acc.add(nb);
                queue.push(nb);
            }
        });
    }
    return acc;
}

/** 某节点的全部后代 */
export function descendantsOf(g: DirectedGraph, nodeId: string): Set<string> {
    const acc = new Set<string>();
    const queue = [nodeId];
    while (queue.length > 0) {
        const cur = queue.shift()!;
        g.forEachOutNeighbor(cur, (nb) => {
            if (!acc.has(nb)) {
                acc.add(nb);
                queue.push(nb);
            }
        });
    }
    return acc;
}

/** 关键路径节点（最长路径上的节点） */
export function criticalNodes(g: DirectedGraph): Set<string> {
    if (g.order === 0) return new Set();

    const order = topoOrder(g);
    // longest[u] = 从源到 u 的最长路径边数
    const longest = new Map<string, number>();
    for (const u of order) {
        let best = 0;
        g.forEachInNeighbor(u, (p) => {
            best = Math.max(best, (longest.get(p) ?? 0) + 1);
        });
        longest.set(u, best);
    }
    // down[u] = 从 u 到汇的最长路径边数
    const down = new Map<string, number>();
    for (const u of [...order].reverse()) {
        let best = 0;
        g.forEachOutNeighbor(u, (c) => {
            best = Math.max(best, (down.get(c) ?? 0) + 1);
        });
        down.set(u, best);
    }
    let globalMax = 0;
    for (const u of order) {
        globalMax = Math.max(globalMax, (longest.get(u) ?? 0) + (down.get(u) ?? 0));
    }

    const critical = new Set<string>();
    for (const u of order) {
        if ((longest.get(u) ?? 0) + (down.get(u) ?? 0) === globalMax) {
            critical.add(u);
        }
    }
    return critical;
}

/** 某节点距最近终端节点的最短跳数（BFS，无权） */
export function distanceToTerminal(g: DirectedGraph, nodeId: string): number {
    if (g.outDegree(nodeId) === 0) return 0;
    const visited = new Set<string>([nodeId]);
    let frontier = [nodeId];
    let dist = 0;
    while (frontier.length > 0) {
        dist++;
        const next: string[] = [];
        for (const cur of frontier) {
            let hit = false;
            g.forEachOutNeighbor(cur, (nb) => {
                if (g.outDegree(nb) === 0) hit = true;
                if (!visited.has(nb)) {
                    visited.add(nb);
                    next.push(nb);
                }
            });
            if (hit) return dist;
        }
        frontier = next;
    }
    return -1;
}

/** 结构信号（供 reAct 价值判断使用） */
export interface NodeStructuralSignal {
    directConsumers: number;
    totalDescendants: number;
    distanceToTerminal: number;
    onCriticalPath: boolean;
}

export function structuralSignal(g: DirectedGraph, nodeId: string): NodeStructuralSignal {
    let directConsumers = 0;
    g.forEachOutNeighbor(nodeId, () => { directConsumers++; });
    return {
        directConsumers,
        totalDescendants: descendantsOf(g, nodeId).size,
        distanceToTerminal: distanceToTerminal(g, nodeId),
        onCriticalPath: criticalNodes(g).has(nodeId),
    };
}