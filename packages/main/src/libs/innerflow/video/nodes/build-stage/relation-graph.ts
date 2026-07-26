// nodes/build-stage/relation-graph.ts
import { DirectedGraph, MultiDirectedGraph } from "graphology";
import { topologicalSort } from "graphology-dag";
import type { SpatialRelation, StageEntity } from "./types.js";

/** 支撑型关系（决定 y 高度的堆叠链） */
const SUPPORT_RELATIONS = new Set<string>(["on_top_of", "holds"]);

interface EdgeAttr {
    relation: string;
    note?: string;
}

/**
 * 用 graphology 承载空间关系。
 * - 全量关系用多重有向图存储（MultiDirectedGraph）
 * - 支撑关系单独抽出一张 DAG（DirectedGraph），用 graphology-dag 求拓扑序，自底向上定高
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
            this.g.addEdge(r.subject, r.object, {
                relation: r.relation,
                note: r.note,
            });
        }
    }

    /** 支撑链拓扑序：底部支撑物在前，被支撑物在后 */
    supportOrder(): string[] {
        // 支撑图：object(底) -> subject(上)，保证底部先处理
        const dag = new DirectedGraph({ allowSelfLoops: false });
        this.g.forEachNode((n) => dag.addNode(n));
        this.g.forEachEdge((_e, attr, source, target) => {
            if (!SUPPORT_RELATIONS.has(attr.relation)) return;
            // on_top_of(A,B)=A在B上 → source=A,target=B → 底是 B → 边 B->A
            if (!dag.hasEdge(target, source)) {
                try { dag.addEdge(target, source); } catch { /* 忽略重边 */ }
            }
        });

        try {
            return topologicalSort(dag);
        } catch {
            // 出现环，退化为节点原序
            return dag.nodes();
        }
    }

    /** 找支撑该实体的底座（on_top_of/holds 的 object），无则 null */
    supporterOf(id: string): string | null {
        let found: string | null = null;
        this.g.forEachOutEdge(id, (_e, attr, _s, target) => {
            if (SUPPORT_RELATIONS.has(attr.relation)) found = target;
        });
        return found;
    }

    /** 度数最高的实体，作为求解器的锚点种子 */
    anchorEntity(): string | null {
        let best: string | null = null;
        let bestDeg = -1;
        this.g.forEachNode((n) => {
            const d = this.g.degree(n);
            if (d > bestDeg) { bestDeg = d; best = n; }
        });
        return best;
    }
}