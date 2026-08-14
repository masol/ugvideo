/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * weaver · preprocess-artifacts · artifact 名归一化 + DAG 修复
 */

import type { WeaveContext } from "../../context.js";
import { addEdge, addNode } from "../../graph/gdag.js";
import type { Artifact, HumanFlow, HumanNode } from "../../types.js";

export interface ReconcileResult {
    changed: boolean;
    renameMap: Record<string, string>;
    remainingDuplicateProducers: string[];
    remainingOrphans: string[];
}

/**
 * 第 1 层：fuse.js 自动归一化
 */
export function reconcileWithFuse(
    ctx: WeaveContext,
    flow: HumanFlow,
): ReconcileResult {
    const Fuse = (globalThis as any).Fuse;
    const renameMap: Record<string, string> = {};

    if (typeof Fuse !== "function") {
        return {
            changed: false,
            renameMap,
            remainingDuplicateProducers: [],
            remainingOrphans: [],
        };
    }

    const artifacts = ctx.conceptManager.artifacts.list() as Artifact[];
    const artifactNames = artifacts.map((a) => a.name);

    if (artifactNames.length === 0) {
        return {
            changed: false,
            renameMap,
            remainingDuplicateProducers: [],
            remainingOrphans: [],
        };
    }

    const fuse = new Fuse(artifactNames, {
        threshold: 0.3,
        includeScore: true,
        ignoreLocation: true,
    });

    const tryRename = (name: string): string => {
        if (artifactNames.includes(name)) return name;
        const hits = fuse.search(name);
        if (hits.length === 0) return name;
        const best = hits[0];
        if (best.score !== undefined && best.score <= 0.3) {
            renameMap[name] = best.item;
            return best.item;
        }
        return name;
    };

    let changed = false;
    for (const node of ctx.conceptManager.nodes.list()) {
        const hn = node as HumanNode;
        const newInputs = hn.inputs.map(tryRename);
        const newOutputs = hn.outputs.map(tryRename);
        if (
            newInputs.some((v, i) => v !== hn.inputs[i]) ||
            newOutputs.some((v, i) => v !== hn.outputs[i])
        ) {
            hn.inputs = newInputs;
            hn.outputs = newOutputs;
            changed = true;
        }
    }

    // 同步更新 artifact.name（保证 conceptManager 中的 artifact 与节点引用的名字一致）
    for (const [oldName, newName] of Object.entries(renameMap)) {
        const artifact = ctx.conceptManager.artifacts.getByName(oldName);
        if (artifact) {
            artifact.name = newName;
            artifact.id = newName;
        }
    }

    return detectRemainingIssues(ctx, flow, renameMap, changed);
}

/**
 * 第 2 层：基于 standard_doc 重建
 */
export async function reconcileWithStandardDoc(
    ctx: WeaveContext,
    flow: HumanFlow,
    docIndex: number,
): Promise<ReconcileResult> {
    const standardDoc = ctx.storage.workflow.getStandardDoc(docIndex);
    if (!standardDoc) {
        return {
            changed: false,
            renameMap: {},
            remainingDuplicateProducers: [],
            remainingOrphans: [],
        };
    }

    const renameMap: Record<string, string> = {};
    const standardNames = extractArtifactNamesFromStandardDoc(standardDoc);
    if (standardNames.size === 0) {
        return {
            changed: false,
            renameMap,
            remainingDuplicateProducers: [],
            remainingOrphans: [],
        };
    }

    const Fuse = (globalThis as any).Fuse;
    const standardFuse =
        typeof Fuse === "function"
            ? new Fuse([...standardNames], {
                threshold: 0.4,
                includeScore: true,
                ignoreLocation: true,
            })
            : null;

    const tryStandardRename = (name: string): string => {
        if (standardNames.has(name)) return name;
        if (!standardFuse) return name;
        const hits = standardFuse.search(name);
        if (hits.length === 0) return name;
        const best = hits[0];
        if (best.score !== undefined && best.score <= 0.4) {
            renameMap[name] = best.item;
            return best.item;
        }
        return name;
    };

    let changed = false;
    for (const node of ctx.conceptManager.nodes.list()) {
        const hn = node as HumanNode;
        const newInputs = hn.inputs.map(tryStandardRename);
        const newOutputs = hn.outputs.map(tryStandardRename);
        if (
            newInputs.some((v, i) => v !== hn.inputs[i]) ||
            newOutputs.some((v, i) => v !== hn.outputs[i])
        ) {
            hn.inputs = newInputs;
            hn.outputs = newOutputs;
            changed = true;
        }
    }

    void (changed)

    // 同步更新 artifact.name
    for (const [oldName, newName] of Object.entries(renameMap)) {
        const artifact = ctx.conceptManager.artifacts.getByName(oldName);
        if (artifact) {
            artifact.name = newName;
            artifact.id = newName;
        }
    }

    syncArtifactsWithStandardDoc(ctx, standardNames);
    rebuildDagEdges(ctx, flow);

    return detectRemainingIssues(ctx, flow, renameMap, true);
}

function extractArtifactNamesFromStandardDoc(doc: string): Set<string> {
    const names = new Set<string>();
    const lines = doc.split("\n");
    for (const line of lines) {
        if (!/输入[：:]/.test(line) && !/输出[：:]/.test(line)) continue;
        const matches = [...line.matchAll(/`([^`]+)`/g)];
        for (const m of matches) {
            const name = m[1].trim();
            if (name && name !== "（无）" && name !== "无") {
                names.add(name);
            }
        }
    }
    return names;
}

function syncArtifactsWithStandardDoc(
    ctx: WeaveContext,
    standardNames: Set<string>,
): void {
    const existing = ctx.conceptManager.artifacts.list();
    const existingNames = new Set(existing.map((a) => a.name));

    for (const name of standardNames) {
        if (!existingNames.has(name)) {
            const artifact: Artifact = {
                kind: "artifact",
                id: name,
                name,
                aliases: [],
                intent: name,
                inferred: true,
                constraintIds: [],
                shape: "scalar",
                semanticFields: [],
                relations: {
                    partOf: [],
                    composedOf: [],
                    arrayOf: null,
                    refinedFrom: [],
                },
            };
            ctx.conceptManager.artifacts.register(artifact);
        }
    }
}

function rebuildDagEdges(ctx: WeaveContext, flow: HumanFlow): void {
    const nodes = flow.g
        .nodes()
        .map((id) => ctx.conceptManager.nodes.get(id))
        .filter((n): n is HumanNode => n !== null);

    // 先收集所有边
    const edgesToDrop: Array<{ source: string; target: string }> = [];
    flow.g.forEachEdge((_edge, _attrs, source, target) => {
        edgesToDrop.push({ source, target });
    });

    // 删除所有边
    for (const { source, target } of edgesToDrop) {
        flow.g.dropEdge(source, target);
    }

    // 基于 inputs/outputs 重建
    for (const node of nodes) {
        if (!flow.g.hasNode(node.id)) addNode(flow.g, node.id);
        for (const inputName of node.inputs) {
            const producer = findProducer(ctx, inputName);
            if (producer && producer !== node.id && !flow.g.hasEdge(producer, node.id)) {
                addEdge(flow.g, producer, node.id);
            }
        }
    }
}

function findProducer(ctx: WeaveContext, artifactName: string): string | null {
    for (const node of ctx.conceptManager.nodes.list()) {
        const hn = node as HumanNode;
        if (hn.outputs.includes(artifactName)) return hn.id;
    }
    return null;
}

function detectRemainingIssues(
    ctx: WeaveContext,
    flow: HumanFlow,
    renameMap: Record<string, string>,
    changed: boolean,
): ReconcileResult {
    const nodes = flow.g
        .nodes()
        .map((id) => ctx.conceptManager.nodes.get(id))
        .filter((n): n is HumanNode => n !== null);

    const producerCount = new Map<string, number>();
    const consumerCount = new Map<string, number>();

    for (const node of nodes) {
        for (const outId of node.outputs) {
            producerCount.set(outId, (producerCount.get(outId) ?? 0) + 1);
        }
        for (const inId of node.inputs) {
            consumerCount.set(inId, (consumerCount.get(inId) ?? 0) + 1);
        }
    }

    const remainingDuplicateProducers: string[] = [];
    for (const [name, count] of producerCount) {
        if (count > 1) remainingDuplicateProducers.push(name);
    }

    const remainingOrphans: string[] = [];
    for (const [name, count] of consumerCount) {
        if (count > 0 && !producerCount.has(name)) {
            const isFlowInput = flow.inputs.includes(name);
            if (!isFlowInput) remainingOrphans.push(name);
        }
    }

    return {
        changed,
        renameMap,
        remainingDuplicateProducers,
        remainingOrphans,
    };
}