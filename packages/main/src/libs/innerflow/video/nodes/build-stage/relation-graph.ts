// nodes/build-stage/relation-graph.ts
import { DirectedGraph, MultiDirectedGraph } from "graphology";
import { topologicalSort } from "graphology-dag";
import type { SpatialRelation, StageEntity } from "./types.js";

interface EdgeAttr {
    relation: string;
    note?: string;
}

/**
 * 承载空间拓扑关系（梦境级物理，不追求精确）。
 *
 * 区分两种「附着」语义，修正旧实现把 holds 当竖直堆叠的 bug：
 * - on_top_of(A,B)：A 竖直堆叠在 B 之上 → 决定 y 高度（拓扑 DAG 求序）
 * - holds(P,O)：P 持有 O → O 附着到 P 的手部（不堆到头顶）
 */
export class RelationGraph {
    private g: MultiDirectedGraph<Record<string, unknown>, EdgeAttr>;

    constructor(entities: StageEntity[], relations: SpatialRelation[]) {
        this.g = new MultiDirectedGraph<Record<string, unknown>, EdgeAttr>({
            allowSelfLoops: false,
        });
        for (const e of entities) {
            if (!this.g.hasNode(e.id)) this.g.addNode(e.id, { kind: e.kind });
        }
        for (const r of relations) {
            if (!this.g.hasNode(r.subject) || !this.g.hasNode(r.object)) continue;
            if (r.subject === r.object) continue;
            this.g.addEdge(r.subject, r.object, { relation: r.relation, note: r.note });
        }
    }

    /** on_top_of 堆叠链拓扑序：底座在前，被堆叠物在后 */
    stackOrder(): string[] {
        const dag = new DirectedGraph({ allowSelfLoops: false });
        this.g.forEachNode((n) => dag.addNode(n));
        this.g.forEachEdge((_e, attr, source, target) => {
            if (attr.relation !== "on_top_of") return;
            // on_top_of(A,B): A 在 B 上 → 底是 B → 边 B->A（底先处理）
            if (!dag.hasEdge(target, source)) {
                try { dag.addEdge(target, source); } catch { /* 忽略重边 */ }
            }
        });
        try {
            return topologicalSort(dag);
        } catch {
            return dag.nodes(); // 出环退化为原序
        }
    }

    /** 找 id 竖直堆叠的底座（on_top_of 的 object），无则 null */
    stackBaseOf(id: string): string | null {
        let found: string | null = null;
        this.g.forEachOutEdge(id, (_e, attr, _s, target) => {
            if (attr.relation === "on_top_of") found = target;
        });
        return found;
    }

    /** 找持有 id 这件物体的持有者（holds 的 subject），无则 null */
    holderOf(id: string): string | null {
        let holder: string | null = null;
        this.g.forEachInEdge(id, (_e, attr, source) => {
            if (attr.relation === "holds") holder = source;
        });
        return holder;
    }
}