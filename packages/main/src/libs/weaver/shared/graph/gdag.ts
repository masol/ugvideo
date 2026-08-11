/**
 * weaver · graphology 封装
 *
 * FlowGraph.g 是 graphology.DirectedGraph。
 * 本文件提供辅助函数（创建、添加节点/边、查询）。
 */

import { DirectedGraph } from 'graphology';

export type { DirectedGraph };

/** 创建新的空图 */
export function createGraph(): DirectedGraph {
    return new DirectedGraph();
}

/**
 * 添加节点（attrs 只记 nodeId 字符串引用）
 */
export function addNode(g: DirectedGraph, nodeId: string): void {
    if (!g.hasNode(nodeId)) {
        g.addNode(nodeId, { nodeId });
    }
}

/**
 * 添加边（attrs 记 edgeId 或 crossGraphTarget）
 */
export function addEdge(
    g: DirectedGraph,
    from: string,
    to: string,
    attrs: { edgeId?: string; condition?: string; crossGraphTarget?: { graphId: string; nodeId: string } } = {},
): void {
    if (!g.hasEdge(from, to)) {
        g.addEdge(from, to, attrs);
    } else {
        // 已存在边 → 逐属性合并
        for (const [key, value] of Object.entries(attrs)) {
            g.setEdgeAttribute(from, to, key, value);
        }
    }
}

/**
 * 移除节点（同时移除相关边）
 */
export function removeNode(g: DirectedGraph, nodeId: string): void {
    if (g.hasNode(nodeId)) {
        g.dropNode(nodeId);
    }
}

/**
 * 移除边
 */
export function removeEdge(g: DirectedGraph, from: string, to: string): void {
    if (g.hasEdge(from, to)) {
        g.dropEdge(from, to);
    }
}

/**
 * 重建 graphology（从 JSON 导出恢复）
 */
export function fromJSON(json: ReturnType<DirectedGraph['export']>): DirectedGraph {
    return DirectedGraph.from(json);
}

/**
 * 导出为 JSON
 */
export function toJSON(g: DirectedGraph): ReturnType<DirectedGraph['export']> {
    return g.export();
}