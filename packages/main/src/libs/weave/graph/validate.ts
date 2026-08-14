/**
 * weaver · DAG 验证（含路径级输入闭合性）
 */

import type { DirectedGraph } from "graphology";
import { hasCycle } from "graphology-dag";
import type { ConceptManager } from "../concept/concept-manager.js";
import type { FlowGraph, FlowNode, HumanFlow } from "../types.js";
import { topoOrder } from "./graph-ops.js";

export interface ValidationError {
    kind:
    | "cycle" | "orphan" | "orphan-edge" | "missing-input" | "missing-output"
    | "multiple-terminal" | "no-terminal"
    | "missing-concept" | "unreachable";
    severity: "error" | "warning";
    nodeId?: string;
    graphId?: string;
    message: string;
    category: "missing-concept" | "missing-node" | "missing-io" | "structural";
    pathContext?: string[];
}

export function validateHumanFlow(
    flow: HumanFlow,
    conceptManager: ConceptManager,
    maxPathsPerNode?: number,
): ValidationError[] {
    const errors: ValidationError[] = [];
    const g = flow.g;
    const flowNodes = collectFlowNodes(flow, conceptManager);

    if (hasCycle(g)) {
        errors.push({
            kind: "cycle",
            severity: "error",
            message: "图存在循环",
            category: "structural",
        });
    }

    const order = topoOrder(g);
    if (order.length !== g.order) {
        errors.push({
            kind: "unreachable",
            severity: "error",
            message: `存在不可达节点：图共 ${g.order} 个，拓扑序仅 ${order.length} 个`,
            category: "structural",
        });
    }

    const terminals = terminalNodesPure(g);
    if (terminals.length === 0) {
        errors.push({
            kind: "no-terminal",
            severity: "error",
            message: "图中不存在终端节点",
            category: "structural",
        });
    } else if (terminals.length > 1) {
        errors.push({
            kind: "multiple-terminal",
            severity: "warning",
            message: `存在多个终端节点：${terminals.map((t) => `「${t}」`).join("、")}；` +
                `已由 buildHumanFlow 自动补全边，保证只有一个真正终点。`,
            category: "structural",
        });
    }

    const pathClosureErrors = validatePathClosure(
        g,
        flowNodes,
        conceptManager,
        maxPathsPerNode ?? 50,
    );
    errors.push(...pathClosureErrors);

    for (const node of flowNodes) {
        for (const cid of node.constraintIds) {
            if (!conceptManager.get(cid)) {
                errors.push({
                    kind: "missing-concept",
                    severity: "error",
                    nodeId: node.id,
                    message: `节点「${node.name}」挂载的约束器「${cid}」不存在`,
                    category: "missing-concept",
                });
            }
        }
    }

    for (const node of flowNodes) {
        for (const outId of node.outputs) {
            if (!conceptManager.get(outId)) {
                errors.push({
                    kind: "missing-output",
                    severity: "error",
                    nodeId: node.id,
                    message: `节点「${node.name}」的输出「${outId}」不在概念表中`,
                    category: "missing-concept",
                });
            }
        }
    }

    return errors;
}

export function blockingErrors(errors: ValidationError[]): ValidationError[] {
    return errors.filter((e) => e.severity === "error");
}

// ════════════════════════════════════════════════════════════════════
// 路径级输入闭合性校验
// ════════════════════════════════════════════════════════════════════

function validatePathClosure(
    g: DirectedGraph,
    flowNodes: FlowNode[],
    conceptManager: ConceptManager,
    maxPathsPerNode: number,
): ValidationError[] {
    const errors: ValidationError[] = [];
    const nodeById = new Map(flowNodes.map((n) => [n.id, n]));
    const initial = initialNodesPure(g);

    for (const node of flowNodes) {
        const paths = enumeratePathsTo(g, initial, node.id, maxPathsPerNode);
        if (paths.length === 0) {
            errors.push({
                kind: "unreachable",
                severity: "error",
                nodeId: node.id,
                message: `节点「${node.name}」不可达`,
                category: "structural",
            });
            continue;
        }

        const requiredArtifacts = collectRequiredArtifactNames(node, conceptManager);
        const missingByPath: string[][] = [];

        for (const path of paths) {
            const producedOnPath = new Set<string>();
            for (const ancestorId of path.slice(0, -1)) {
                const ancestor = nodeById.get(ancestorId);
                if (ancestor) {
                    for (const outId of ancestor.outputs) {
                        const a = conceptManager.artifacts.get(outId);
                        if (a) producedOnPath.add(a.name);
                    }
                }
            }
            const missing = requiredArtifacts.filter((name) => !producedOnPath.has(name));
            if (missing.length > 0) missingByPath.push(missing);
        }

        if (missingByPath.length === paths.length) {
            errors.push({
                kind: "missing-input",
                severity: "error",
                nodeId: node.id,
                message: `节点「${node.name}」在所有路径上都缺少输入：${missingByPath[0].join(", ")}`,
                category: "missing-io",
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
        if (init === target) results.push([init]);
        else dfs(init, [init]);
    }
    return results;
}

function collectRequiredArtifactNames(
    node: FlowNode,
    conceptManager: ConceptManager,
): string[] {
    const names: string[] = [];
    for (const inputId of node.inputs) {
        const a = conceptManager.artifacts.get(inputId);
        if (a) names.push(a.name);
    }
    return names;
}

// ════════════════════════════════════════════════════════════════════
// 辅助
// ════════════════════════════════════════════════════════════════════

function collectFlowNodes(flow: FlowGraph, conceptManager: ConceptManager): FlowNode[] {
    const out: FlowNode[] = [];
    for (const nodeId of flow.g.nodes()) {
        const node = conceptManager.get(nodeId);
        if (node && (node.kind === "flow-node" || node.kind === "human")) {
            out.push(node as FlowNode);
        }
    }
    return out;
}

function terminalNodesPure(g: DirectedGraph): string[] {
    const out: string[] = [];
    g.forEachNode((id) => { if (g.outDegree(id) === 0) out.push(id); });
    return out;
}

function initialNodesPure(g: DirectedGraph): string[] {
    const out: string[] = [];
    g.forEachNode((id) => { if (g.inDegree(id) === 0) out.push(id); });
    return out;
}

export function classifyError(err: ValidationError): "missing-concept" | "missing-node" | "missing-io" | "structural" {
    return err.category;
}

export function errorsToString(errors: ValidationError[]): string {
    return errors
        .filter((e) => e.severity === "error")
        .map((e, i) => `${i + 1}. [${e.kind}] ${e.message}`)
        .join("\n");
}