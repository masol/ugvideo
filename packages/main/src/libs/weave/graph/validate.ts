/**
 * weaver · DAG 验证（含路径级输入闭合性）
 */

import type { DirectedGraph } from 'graphology';
import { hasCycle } from 'graphology-dag';
import type { CompiledProducts } from '../concept/compiled-products.js';
import type { ConceptTable } from '../concept/concept-table.js';
import type { FlowGraph, FlowNode, HumanFlow } from '../types.js';
import { topoOrder } from './graph-ops.js';

export interface ValidationError {
    kind:
    | 'cycle' | 'orphan' | 'orphan-edge' | 'missing-input' | 'missing-output'
    | 'multiple-terminal' | 'no-terminal' | 'invalid-external-edge'
    | 'missing-concept' | 'unreachable' | 'invalid-jump-target';
    nodeId?: string;
    edgeId?: string;
    graphId?: string;
    message: string;
    category: 'missing-concept' | 'missing-node' | 'missing-io' | 'structural';
    pathContext?: string[];
}

export function validateHumanFlow(
    flow: HumanFlow,
    conceptTable: ConceptTable,
    compiled: CompiledProducts,
): ValidationError[] {
    const errors: ValidationError[] = [];
    const g = flow.g;
    const flowNodes = collectFlowNodes(flow, conceptTable);
    const externalInputs = compiled.getExternalInputs(flow.id);

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

    // 4. 路径级输入闭合性
    const pathClosureErrors = validatePathClosure(
        g, flowNodes, externalInputs, conceptTable,
    );
    errors.push(...pathClosureErrors);

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

    // 6. 约束可达
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

    // 7. outputs 合法性
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
// 路径级输入闭合性校验
// ════════════════════════════════════════════════════════════════════

const MAX_PATHS_PER_NODE = 50;

function validatePathClosure(
    g: DirectedGraph,
    flowNodes: FlowNode[],
    externalInputs: import('../types.js').ExternalInput[],
    conceptTable: ConceptTable,
): ValidationError[] {
    const errors: ValidationError[] = [];
    const nodeById = new Map(flowNodes.map(n => [n.id, n]));

    // 从 ExternalInput 构造外部输入 artifact 名集合
    const externalInputNames = new Set<string>();
    for (const ext of externalInputs) {
        const artifact = conceptTable.get(ext.artifactId);
        if (artifact && artifact.kind === 'artifact') {
            externalInputNames.add(artifact.name);
        }
    }

    const initial = initialNodesPure(g);

    for (const node of flowNodes) {
        const paths = enumeratePathsTo(g, initial, node.id, MAX_PATHS_PER_NODE);
        if (paths.length === 0) {
            errors.push({
                kind: 'unreachable',
                nodeId: node.id,
                message: `节点「${node.name}」不可达`,
                category: 'structural',
            });
            continue;
        }

        const requiredArtifacts = collectRequiredArtifactNames(node, conceptTable);
        const missingByPath: string[][] = [];

        for (const path of paths) {
            const producedOnPath = new Set<string>();
            for (const ancestorId of path.slice(0, -1)) {
                const ancestor = nodeById.get(ancestorId);
                if (ancestor) {
                    for (const outId of ancestor.outputs) {
                        const a = conceptTable.get(outId);
                        if (a && a.kind === 'artifact') producedOnPath.add(a.name);
                    }
                }
            }

            const missing = requiredArtifacts.filter(
                name => !producedOnPath.has(name) && !externalInputNames.has(name),
            );
            if (missing.length > 0) {
                missingByPath.push(missing);
            }
        }

        if (missingByPath.length === paths.length) {
            errors.push({
                kind: 'missing-input',
                nodeId: node.id,
                message: `节点「${node.name}」在所有路径上都缺少输入：${missingByPath[0].join(', ')}`,
                category: 'missing-io',
                pathContext: paths[0],
            });
        }
    }

    return errors;
}

function enumeratePathsTo(
    g: DirectedGraph,
    initials: string[],
    target: string,
    limit: number,
): string[][] {
    const results: string[][] = [];

    function dfs(current: string, path: string[]): void {
        if (results.length >= limit) return;
        if (current === target) {
            results.push([...path]);
            return;
        }
        g.forEachOutNeighbor(current, (next) => {
            if (path.includes(next)) return;
            path.push(next);
            dfs(next, path);
            path.pop();
        });
    }

    for (const init of initials) {
        if (results.length >= limit) break;
        if (init === target) {
            results.push([init]);
        } else {
            dfs(init, [init]);
        }
    }

    return results;
}

function collectRequiredArtifactNames(
    node: FlowNode,
    conceptTable: ConceptTable,
): string[] {
    const names: string[] = [];
    for (const inputId of node.inputs) {
        const a = conceptTable.get(inputId);
        if (a && a.kind === 'artifact') names.push(a.name);
    }
    return names;
}

// ════════════════════════════════════════════════════════════════════
// 辅助
// ════════════════════════════════════════════════════════════════════

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

function terminalNodesPure(g: DirectedGraph): string[] {
    const out: string[] = [];
    g.forEachNode((id) => {
        if (g.outDegree(id) === 0) out.push(id);
    });
    return out;
}

function initialNodesPure(g: DirectedGraph): string[] {
    const out: string[] = [];
    g.forEachNode((id) => {
        if (g.inDegree(id) === 0) out.push(id);
    });
    return out;
}

export function classifyError(err: ValidationError): 'missing-concept' | 'missing-node' | 'missing-io' | 'structural' {
    return err.category;
}

export function errorsToString(errors: ValidationError[]): string {
    return errors.map((e, i) => `${i + 1}. [${e.kind}] ${e.message}`).join('\n');
}