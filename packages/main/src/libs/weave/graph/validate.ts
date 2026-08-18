/**
 * weaver · DAG 验证（含路径级输入闭合性）
 *
 * v14 变更：
 *   - 新增 `no-non-config-output` 校验：工作流必须至少有一个非 Config 的最终产物
 *   - 新增 `no-non-config-input` 校验：工作流必须至少有一个非 Config 的外部输入
 */

import type { DirectedGraph } from "graphology";
import { hasCycle } from "graphology-dag";
import type { ConceptManager } from "../concept/concept-manager.js";
import type { Config, FlowGraph, FlowNode, HumanFlow } from "../types.js";
import { topoOrder } from "./graph-ops.js";

export interface ValidationError {
    kind:
    | "cycle" | "orphan" | "orphan-edge" | "missing-input" | "missing-output"
    | "multiple-terminal" | "no-terminal"
    | "missing-concept" | "unreachable"
    | "no-non-config-input" | "no-non-config-output";
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

    // ── 非配置输入/输出校验 ──
    errors.push(...validateNonConfigInput(flow, conceptManager));
    errors.push(...validateNonConfigOutput(flow, conceptManager));

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
// 非配置输入/输出校验
// ════════════════════════════════════════════════════════════════════

/**
 * 校验工作流必须至少有一个非 Config 的外部输入。
 *
 * Config = 带默认值的固定素材（模板/公式/清单），不需要用户提供。
 * 若工作流的所有输入都是 Config，意味着工作流没有任何"待处理的外部材料"，
 * 等同于纯配置驱动，没有实际的处理对象——这不是一个有意义的工作流。
 */
function validateNonConfigInput(
    flow: HumanFlow,
    conceptManager: ConceptManager,
): ValidationError[] {
    if (flow.inputs.length === 0) {
        return [{
            kind: "no-non-config-input",
            severity: "error",
            graphId: flow.id,
            message:
                `工作流「${flow.name}」没有任何外部输入。` +
                `一个有意义的工作流必须接收至少一个需要用户提供的输入（非配置项），` +
                `作为整个处理流程的起始材料。` +
                `请在「全局输入」中添加至少一个「输入项」（不带默认值的外部材料），` +
                `并确保有步骤在「输入」中引用它。`,
            category: "missing-io",
        }];
    }

    const hasNonConfigInput = flow.inputs.some((name) => {
        const artifact = conceptManager.artifacts.getByName(name);
        if (!artifact) return true;
        return (artifact as Config).isConfig !== true;
    });

    if (!hasNonConfigInput) {
        return [{
            kind: "no-non-config-input",
            severity: "error",
            graphId: flow.id,
            message:
                `工作流「${flow.name}」的所有输入均为 Config（带默认值的配置项），` +
                `没有任何需要用户提供的外部材料。` +
                `一个有意义的工作流必须接收至少一个非配置项的输入，作为处理的起始对象。` +
                `请在「全局输入」中添加至少一个「输入项」（不带默认值），` +
                `并确保首个步骤的「输入」中引用它、「动作」中使用它。`,
            category: "missing-io",
        }];
    }

    return [];
}

/**
 * 校验工作流必须至少有一个非 Config 的最终产物。
 *
 * 若所有输出都是 Config，工作流没有"处理后产出有价值结果"的语义——无意义。
 */
function validateNonConfigOutput(
    flow: HumanFlow,
    conceptManager: ConceptManager,
): ValidationError[] {
    if (flow.outputs.length === 0) return [];

    const hasNonConfigOutput = flow.outputs.some((name) => {
        const artifact = conceptManager.artifacts.getByName(name);
        if (!artifact) return false;
        return (artifact as Config).isConfig !== true;
    });

    if (!hasNonConfigOutput) {
        return [{
            kind: "no-non-config-output",
            severity: "error",
            graphId: flow.id,
            message:
                `工作流「${flow.name}」的所有输出均为 Config，无任何有意义的产物产出。` +
                `一个工作流必须接收输入并产生至少一个非配置项的最终产物。` +
                `请检查：(a) 是否漏写了某些步骤应产出的非配置产物；` +
                `(b) 是否所有产出的 artifact 都被错误地标记为 Config 类型；` +
                `(c) 整体工作流是否缺少一个产出最终交付物的收尾步骤。`,
            category: "missing-io",
        }];
    }

    return [];
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