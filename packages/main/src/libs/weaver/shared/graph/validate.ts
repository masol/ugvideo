/**
 * weaver · DAG 验证
 *
 * 纯代码校验：基于 FlowGraph.g + ConceptTable。
 * 校验清单：
 *   1. 无环
 *   2. 依赖闭合（每节点 inputs 都能在前置 outputs ∪ externalInputs 找到）
 *   3. 终端唯一
 *   4. 外部边引用合法
 *   5. 约束可达（subject / target 概念存在）
 *   6. 全节点可达
 */

import type { DirectedGraph } from 'graphology';
import { hasCycle } from 'graphology-dag';
import type { CompiledProducts } from '../concept/compiled-products.js';
import type { ConceptTable } from '../concept/concept-table.js';
import type { FlowGraph, FlowNode, HumanFlow } from '../types.js';
import { topoOrder } from './graph-ops.js';

export interface ValidationError {
    kind: 'cycle' | 'orphan' | 'orphan-edge' | 'missing-input' | 'missing-output'
    | 'multiple-terminal' | 'no-terminal' | 'invalid-external-edge'
    | 'missing-concept' | 'unreachable';
    nodeId?: string;
    edgeId?: string;
    graphId?: string;
    message: string;
    /** 错误分类——决定回溯方向 */
    category: 'missing-concept' | 'missing-node' | 'missing-io' | 'structural';
}

/**
 * 主验证入口
 */
export function validateHumanFlow(
    flow: HumanFlow,
    conceptTable: ConceptTable,
    compiled: CompiledProducts,
): ValidationError[] {
    const errors: ValidationError[] = [];
    const g = flow.g;
    const flowNodes = collectFlowNodes(flow, conceptTable);

    // 1. 无环
    if (hasCycle(g)) {
        errors.push({
            kind: 'cycle',
            message: '图存在循环',
            category: 'structural',
        });
    }

    // 2. 全节点可达
    const order = topoOrder(g);
    if (order.length !== g.order) {
        errors.push({
            kind: 'unreachable',
            message: `存在不可达节点：图共 ${g.order} 个，拓扑序仅 ${order.length} 个`,
            category: 'structural',
        });
    }

    // 3. 终端唯一
    const terminals = terminalNodesPure(g);
    if (terminals.length === 0) {
        errors.push({
            kind: 'no-terminal',
            message: '图中不存在终端节点',
            category: 'structural',
        });
    } else if (terminals.length > 1) {
        errors.push({
            kind: 'multiple-terminal',
            message: `存在多个终端节点：${terminals.map(t => `「${t}」`).join('、')}`,
            category: 'structural',
        });
    }

    // 4. 依赖闭合
    const externalInputs = compiled.getExternalInputs(flow.id);
    const externalInputNames = new Set(externalInputs.map(e => e.name));

    for (const node of flowNodes) {
        // 收集此节点上游能产出的所有 artifact 名
        const upstreamOutputs = new Set<string>();
        for (const ancestorId of ancestorsOf(g, node.id)) {
            const ancestor = flowNodes.find(n => n.id === ancestorId);
            if (ancestor) {
                for (const out of ancestor.outputs) upstreamOutputs.add(out);
            }
        }
        // 加入外部输入
        for (const ext of externalInputs) upstreamOutputs.add(ext.name);

        // 检查每个 input
        for (const inputName of node.inputs) {
            if (!upstreamOutputs.has(inputName) && !externalInputNames.has(inputName)) {
                errors.push({
                    kind: 'missing-input',
                    nodeId: node.id,
                    message: `节点「${node.name}」的输入「${inputName}」既无前置产出，也不在外部输入中`,
                    category: 'missing-concept',
                });
            }
        }
    }

    // 5. 外部边引用合法
    for (const node of flowNodes) {
        for (const edge of node.externalEdges) {
            if (edge.kind === 'internal') {
                if (!g.hasNode(edge.target)) {
                    errors.push({
                        kind: 'orphan-edge',
                        nodeId: node.id,
                        edgeId: edge.condition ?? 'unconditional',
                        message: `节点「${node.name}」的内部边指向不存在的节点「${edge.target}」`,
                        category: 'structural',
                    });
                }
            } else {
                // 外部边：检查 targetGraphId 存在 + targetNodeId 存在
                const targetGraph = conceptTable.get(edge.targetGraphId);
                if (!targetGraph || targetGraph.kind !== 'dag') {
                    errors.push({
                        kind: 'invalid-external-edge',
                        nodeId: node.id,
                        graphId: edge.targetGraphId,
                        message: `节点「${node.name}」的外部边指向不存在的图「${edge.targetGraphId}」`,
                        category: 'missing-concept',
                    });
                } else {
                    const targetFlow = targetGraph as FlowGraph;
                    if (!targetFlow.g.hasNode(edge.targetNodeId)) {
                        errors.push({
                            kind: 'invalid-external-edge',
                            nodeId: node.id,
                            graphId: edge.targetGraphId,
                            message: `节点「${node.name}」的外部边指向图「${edge.targetGraphId}」中不存在的节点「${edge.targetNodeId}」`,
                            category: 'missing-concept',
                        });
                    }
                }
            }
        }
    }

    // 6. 约束可达（每节点的 validatorIds 引用的约束都存在）
    for (const node of flowNodes) {
        for (const vid of node.validatorIds) {
            if (!conceptTable.get(vid)) {
                errors.push({
                    kind: 'missing-concept',
                    nodeId: node.id,
                    message: `节点「${node.name}」挂载的约束器「${vid}」不存在`,
                    category: 'missing-concept',
                });
            }
        }
    }

    // 7. outputs 合法性（每节点 outputs 指向的概念都存在）
    for (const node of flowNodes) {
        for (const outId of node.outputs) {
            if (!conceptTable.get(outId)) {
                errors.push({
                    kind: 'missing-output',
                    nodeId: node.id,
                    message: `节点「${node.name}」的输出「${outId}」不在概念表中`,
                    category: 'missing-concept',
                });
            }
        }
    }

    return errors;
}

// ════════════════════════════════════════════════════════════════════
// 辅助函数
// ════════════════════════════════════════════════════════════════════

/** 收集 FlowGraph 中的所有 FlowNode */
function collectFlowNodes(flow: FlowGraph, conceptTable: ConceptTable): FlowNode[] {
    const out: FlowNode[] = [];
    for (const nodeId of flow.g.nodes()) {
        const node = conceptTable.get(nodeId);
        if (node && (node.kind === 'flow-node' || node.kind === 'human')) {
            out.push(node as FlowNode);
        }
    }
    return out;
}

/** 纯函数版终端节点（不依赖概念表） */
function terminalNodesPure(g: DirectedGraph): string[] {
    const out: string[] = [];
    g.forEachNode((id) => {
        if (g.outDegree(id) === 0) out.push(id);
    });
    return out;
}

/** 纯函数版祖先 */
function ancestorsOf(g: DirectedGraph, nodeId: string): Set<string> {
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

/** 错误分类辅助——决定 reAct 回溯方向 */
export function classifyError(err: ValidationError): 'missing-concept' | 'missing-node' | 'missing-io' | 'structural' {
    return err.category;
}

/** 错误转字符串（用于 reAct 反馈） */
export function errorsToString(errors: ValidationError[]): string {
    return errors.map((e, i) => `${i + 1}. [${e.kind}] ${e.message}`).join('\n');
}