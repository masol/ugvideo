/**
 * weaver · preprocess-artifacts · 校验报告
 *
 * 校验维度：
 *   1. 关系一致性：关系字段引用合法、partOf/composedOf 互逆、Config 不应被产出；
 *   2. 与 DAG 对齐：节点 inputs/outputs 在 artifact 集合中、unique producer、
 *      orphan / dead artifact 检测；
 *   3. lineage 一致性：lineage 链路无环、终产物存在。
 *
 * duplicate-producer 升级为 error 级——要求 parse 重跑（不在此处改名）。
 */

import type { WeaveContext } from "../../context.js";
import type {
    Artifact,
    ArtifactLineageMap,
    ArtifactRelation,
    HumanFlow,
    HumanNode,
} from "../../types.js";

export interface RelationIssue {
    kind:
    | "missing-relation"
    | "dangling-reference"
    | "inverse-mismatch"
    | "orphan-artifact"
    | "dead-artifact"
    | "missing-final-output"
    | "config-produced"
    | "duplicate-producer"
    | "lineage-cycle";
    severity: "error" | "warning";
    artifactName?: string;
    nodeId?: string;
    message: string;
}

export function validateRelations(
    ctx: WeaveContext,
    flow: HumanFlow,
    relations: Record<string, ArtifactRelation>,
    lineage?: ArtifactLineageMap,
): RelationIssue[] {
    const issues: RelationIssue[] = [];
    const artifactNames = new Set(Object.keys(relations));

    const nodes = flow.g.nodes()
        .map((id) => ctx.conceptManager.nodes.get(id))
        .filter((n): n is HumanNode => n !== null);

    // ── 1. 悬空引用（error） ──
    for (const [name, rel] of Object.entries(relations)) {
        for (const p of rel.partOf ?? []) {
            if (!artifactNames.has(p)) {
                issues.push({
                    kind: "dangling-reference",
                    severity: "error",
                    artifactName: name,
                    message: `产物「${name}」的 partOf 引用了不存在的产物「${p}」`,
                });
            }
        }
        for (const c of rel.composedOf ?? []) {
            if (!artifactNames.has(c)) {
                issues.push({
                    kind: "dangling-reference",
                    severity: "error",
                    artifactName: name,
                    message: `产物「${name}」的 composedOf 引用了不存在的产物「${c}」`,
                });
            }
        }
        if (rel.arrayOf && !artifactNames.has(rel.arrayOf)) {
            issues.push({
                kind: "dangling-reference",
                severity: "error",
                artifactName: name,
                message: `产物「${name}」的 arrayOf 引用了不存在的产物「${rel.arrayOf}」`,
            });
        }
        for (const r of rel.refinedFrom ?? []) {
            if (!artifactNames.has(r)) {
                issues.push({
                    kind: "dangling-reference",
                    severity: "error",
                    artifactName: name,
                    message: `产物「${name}」的 refinedFrom 引用了不存在的产物「${r}」`,
                });
            }
        }
        for (const r of rel.derivedFrom ?? []) {
            if (!artifactNames.has(r)) {
                issues.push({
                    kind: "dangling-reference",
                    severity: "error",
                    artifactName: name,
                    message: `产物「${name}」的 derivedFrom 引用了不存在的产物「${r}」`,
                });
            }
        }
    }

    // ── 2. partOf / composedOf 互逆（warning） ──
    for (const [name, rel] of Object.entries(relations)) {
        for (const parent of rel.partOf ?? []) {
            const parentRel = relations[parent];
            if (!parentRel) continue;
            if (!(parentRel.composedOf ?? []).includes(name)) {
                issues.push({
                    kind: "inverse-mismatch",
                    severity: "warning",
                    artifactName: name,
                    message: `「${name}」partOf「${parent}」，但「${parent}」的 composedOf 不含「${name}」`,
                });
            }
        }
        for (const child of rel.composedOf ?? []) {
            const childRel = relations[child];
            if (!childRel) continue;
            if (!(childRel.partOf ?? []).includes(name)) {
                issues.push({
                    kind: "inverse-mismatch",
                    severity: "warning",
                    artifactName: name,
                    message: `「${name}」composedOf「${child}」，但「${child}」的 partOf 不含「${name}」`,
                });
            }
        }
    }

    // ── 3. 与 DAG 对齐 ──
    const producerCount = new Map<string, string[]>();
    const consumerCount = new Map<string, number>();
    for (const node of nodes) {
        for (const outId of node.outputs) {
            const arr = producerCount.get(outId) ?? [];
            arr.push(node.id);
            producerCount.set(outId, arr);
        }
        for (const inId of node.inputs) {
            consumerCount.set(inId, (consumerCount.get(inId) ?? 0) + 1);
        }
    }

    // 3a. duplicate-producer：error，要求 parse 重跑
    for (const [name, producers] of producerCount) {
        if (producers.length > 1) {
            issues.push({
                kind: "duplicate-producer",
                severity: "error",
                artifactName: name,
                message:
                    `产物「${name}」被 ${producers.length} 个节点产出（${producers.join("、")}），` +
                    `违反"一产物一产出"原则。这不是 preprocess 阶段能修的——` +
                    `请回到原始文档，将产出该产物的步骤拆分为不同 artifact 名` +
                    `（如「草稿骨架」「含开头草稿」「终版草稿」）。`,
            });
        }
    }

    // 3b. Config 被产出：error
    for (const node of nodes) {
        for (const outId of node.outputs) {
            const a = ctx.conceptManager.artifacts.get(outId);
            if (a && (a as Artifact & { isConfig?: boolean }).isConfig === true) {
                issues.push({
                    kind: "config-produced",
                    severity: "error",
                    nodeId: node.id,
                    artifactName: outId,
                    message: `节点「${node.name}」试图产出 Config「${outId}」`,
                });
            }
        }
    }

    // 3c. orphan-artifact：先判定是否 Config，剩余交 LLM 分类
    for (const [name, count] of consumerCount) {
        if (count > 0 && !producerCount.has(name)) {
            const isFlowInput = flow.inputs.includes(name);
            if (isFlowInput) continue;

            const a = ctx.conceptManager.artifacts.get(name);
            if (a && (a as Artifact & { isConfig?: boolean }).isConfig === true) {
                issues.push({
                    kind: "orphan-artifact",
                    severity: "warning",
                    artifactName: name,
                    message: `Config「${name}」被消费但未列入工作流输入，已自动添加`,
                });
                continue;
            }

            issues.push({
                kind: "orphan-artifact",
                severity: "error",
                artifactName: name,
                message:
                    `产物「${name}」被消费但无任何节点产出，且不是工作流输入。` +
                    `请确认：(a) 这应该是外部输入（添加到工作流输入）；` +
                    `(b) 漏写了产出该产物的节点（需用户手动补全）。`,
            });
        }
    }

    // ── 4. lineage 校验 ──
    if (lineage) {
        const visiting = new Set<string>();
        const visited = new Set<string>();
        let hasCycle = false;
        function dfs(name: string): void {
            if (hasCycle) return;
            if (visited.has(name)) return;
            if (visiting.has(name)) {
                hasCycle = true;
                return;
            }
            visiting.add(name);
            const lin = lineage?.byArtifact[name];
            if (lin) {
                for (const p of lin.predecessors) dfs(p);
            }
            visiting.delete(name);
            visited.add(name);
        }
        for (const name of Object.keys(lineage.byArtifact)) dfs(name);
        if (hasCycle) {
            issues.push({
                kind: "lineage-cycle",
                severity: "error",
                message: "artifact lineage 存在环路",
            });
        }

        const hasFinal = Object.values(lineage.byArtifact).some(
            (l) => l.successors.length === 0,
        );
        if (!hasFinal) {
            issues.push({
                kind: "missing-final-output",
                severity: "warning",
                message: "工作流 lineage 中无终产物",
            });
        }
    }

    return issues;
}

export function blockingIssues(issues: RelationIssue[]): RelationIssue[] {
    return issues.filter((i) => i.severity === "error");
}

export function formatIssueFeedback(issues: RelationIssue[]): string[] {
    return issues.map((i) => `[${i.kind}] ${i.message}`);
}