/**
 * weaver · preprocess-artifacts · 静态推导（v2）
 *
 * 变更（v2）：
 * - 修复 duplicate-producer 检测：记录所有 producer（不再丢失第一个）
 */

import type { WeaveContext } from "../../context.js";
import type {
    Artifact,
    ArtifactLineage,
    ArtifactLineageMap,
    HumanFlow,
    HumanNode
} from "../../types.js";

export interface StaticInference {
    refinedFrom: Map<string, string[]>;
    arrayOf: Map<string, string>;
    terminalArtifacts: string[];
    orphanArtifacts: string[];
    duplicateProducers: Map<string, string[]>;
}

export function inferStaticRelations(
    ctx: WeaveContext,
    flow: HumanFlow,
): StaticInference {
    const artifacts = ctx.conceptManager.artifacts.list() as Artifact[];
    const artifactByName = new Map(artifacts.map((a) => [a.name, a]));

    for (const a of artifacts) {
        if (!a.relations) a.relations = {};
    }

    const nodes = flow.g.nodes()
        .map((id) => ctx.conceptManager.nodes.get(id))
        .filter((n): n is HumanNode => n !== null);

    const producerMap = new Map<string, string[]>();
    const consumers = new Map<string, Set<string>>();

    // ── 关键修正：记录所有 producer ──
    for (const node of nodes) {
        for (const outId of node.outputs) {
            const name = artifactByName.get(outId)?.name ?? outId;
            const arr = producerMap.get(name) ?? [];
            arr.push(node.id);
            producerMap.set(name, arr);
        }
        for (const inId of node.inputs) {
            const name = artifactByName.get(inId)?.name ?? inId;
            if (!consumers.has(name)) consumers.set(name, new Set());
            consumers.get(name)!.add(node.id);
        }
    }

    const duplicateProducers = new Map<string, string[]>();
    for (const [name, producers] of producerMap) {
        if (producers.length > 1) {
            duplicateProducers.set(name, producers);
        }
    }

    const refinedFrom = new Map<string, string[]>();
    for (const node of nodes) {
        const inputs = new Set(
            node.inputs.map((id) => artifactByName.get(id)?.name ?? id),
        );
        for (const outId of node.outputs) {
            const outName = artifactByName.get(outId)?.name ?? outId;
            for (const inName of inputs) {
                if (inName !== outName) {
                    const arr = refinedFrom.get(outName) ?? [];
                    arr.push(inName);
                    refinedFrom.set(outName, arr);
                }
            }
        }
    }

    const arrayOf = new Map<string, string>();
    for (const node of nodes) {
        for (const outId of node.outputs) {
            const outArt = artifactByName.get(outId);
            if (!outArt || outArt.shape !== "array") continue;
            for (const inId of node.inputs) {
                const inArt = artifactByName.get(inId);
                if (inArt && inArt.shape === "scalar" && inArt.id !== outArt.id) {
                    if (!arrayOf.has(outArt.name)) {
                        arrayOf.set(outArt.name, inArt.name);
                    }
                }
            }
        }
    }

    const terminalArtifacts: string[] = [];
    for (const [name, producers] of producerMap) {
        if (producers.length === 1) {
            const cs = consumers.get(name);
            if (!cs || cs.size === 0) terminalArtifacts.push(name);
        }
    }

    const orphanArtifacts: string[] = [];
    for (const [name, cs] of consumers) {
        if (cs.size > 0 && !producerMap.has(name)) {
            const isFlowInput = flow.inputs.includes(name);
            if (!isFlowInput) orphanArtifacts.push(name);
        }
    }

    return { refinedFrom, arrayOf, terminalArtifacts, orphanArtifacts, duplicateProducers };
}

export function mergeStaticIntoArtifacts(
    artifacts: Artifact[],
    inference: StaticInference,
): void {
    for (const a of artifacts) {
        if (!a.relations) a.relations = {};
        const r = a.relations;

        const staticRefined = inference.refinedFrom.get(a.name) ?? [];
        if (staticRefined.length > 0) {
            r.refinedFrom = [...new Set([...(r.refinedFrom ?? []), ...staticRefined])];
        }

        if (!r.arrayOf && inference.arrayOf.has(a.name)) {
            r.arrayOf = inference.arrayOf.get(a.name)!;
        }
    }
}

/**
 * 构建 lineage——以 artifact 为中心的思维链，与 DAG 互为镜像。
 */
export function buildLineage(
    ctx: WeaveContext,
    flow: HumanFlow,
): ArtifactLineageMap {
    const artifacts = ctx.conceptManager.artifacts.list() as Artifact[];
    const artifactByName = new Map(artifacts.map((a) => [a.name, a]));

    const nodes = flow.g.nodes()
        .map((id) => ctx.conceptManager.nodes.get(id))
        .filter((n): n is HumanNode => n !== null);

    const producer = new Map<string, string>();
    const consumerMap = new Map<string, string[]>();

    for (const node of nodes) {
        for (const outId of node.outputs) {
            const name = artifactByName.get(outId)?.name ?? outId;
            if (!producer.has(name)) producer.set(name, node.id);
        }
        for (const inId of node.inputs) {
            const name = artifactByName.get(inId)?.name ?? inId;
            const arr = consumerMap.get(name) ?? [];
            if (!arr.includes(node.id)) arr.push(node.id);
            consumerMap.set(name, arr);
        }
    }

    const byArtifact: Record<string, ArtifactLineage> = {};
    for (const a of artifacts) {
        const predecessors = new Set<string>();
        const r = a.relations;
        if (r) {
            for (const p of r.refinedFrom ?? []) predecessors.add(p);
            for (const p of r.composedOf ?? []) predecessors.add(p);
        }

        const producerNode = nodes.find((n) =>
            n.outputs.some((oid) => (artifactByName.get(oid)?.name ?? oid) === a.name),
        );
        if (producerNode) {
            for (const inId of producerNode.inputs) {
                const inName = artifactByName.get(inId)?.name ?? inId;
                predecessors.add(inName);
            }
        }

        byArtifact[a.name] = {
            artifact: a.name,
            predecessors: [...predecessors],
            successors: [],
            producedBy: producer.get(a.name) ?? null,
            consumedBy: consumerMap.get(a.name) ?? [],
            depth: 0,
        };
    }

    for (const lin of Object.values(byArtifact)) {
        for (const pred of lin.predecessors) {
            const predLin = byArtifact[pred];
            if (predLin && !predLin.successors.includes(lin.artifact)) {
                predLin.successors.push(lin.artifact);
            }
        }
    }

    // BFS 计算 depth
    const depths = new Map<string, number>();
    const queue: string[] = [];
    for (const lin of Object.values(byArtifact)) {
        if (lin.predecessors.length === 0) {
            depths.set(lin.artifact, 0);
            queue.push(lin.artifact);
        }
    }
    while (queue.length > 0) {
        const cur = queue.shift()!;
        const curDepth = depths.get(cur)!;
        const lin = byArtifact[cur];
        for (const succ of lin.successors) {
            const newDepth = curDepth + 1;
            if (!depths.has(succ) || depths.get(succ)! < newDepth) {
                depths.set(succ, newDepth);
                queue.push(succ);
            }
        }
    }
    for (const [name, d] of depths) {
        if (byArtifact[name]) byArtifact[name].depth = d;
    }

    // finalLineage：从终产物反向追溯
    const terminals = Object.values(byArtifact).filter((l) => l.successors.length === 0);
    const finalChain: string[] = [];
    const visited = new Set<string>();
    function trace(name: string): void {
        if (visited.has(name)) return;
        visited.add(name);
        const lin = byArtifact[name];
        if (!lin) return;
        finalChain.push(name);
        if (lin.predecessors.length === 0) return;
        for (const p of lin.predecessors) trace(p);
    }
    for (const t of terminals) trace(t.artifact);

    return { byArtifact, finalLineage: finalChain };
}