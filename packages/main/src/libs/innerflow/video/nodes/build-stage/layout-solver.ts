// nodes/build-stage/layout-solver.ts
import { RelationGraph } from "./relation-graph.js";
import {
    sizeOf,
    type EntityTransform,
    type SpatialRelation,
    type StageEntity,
    type StageWorld,
} from "./types.js";

interface Pt { x: number; y: number; z: number; }

const ITER = 160;
const DAMP = 0.25;
const MARGIN = 0.3;
const NEAR_DIST = 0.9;
const NEXT_DIST = 0.55;

/** x-z 平面半径（取该轴半宽） */
function radiusX(e: StageEntity): number { return sizeOf(e.sizeClass)[0] / 2; }
function radiusZ(e: StageEntity): number { return sizeOf(e.sizeClass)[2] / 2; }
function planarRadius(e: StageEntity): number {
    const s = sizeOf(e.sizeClass);
    return Math.max(s[0], s[2]) / 2;
}

/**
 * 定性空间关系 → 确定性 3D 坐标。
 * 约束松弛：先由 DAG 定 y（堆叠高度），再在 x-z 平面迭代满足方向/距离约束，最后附着持有物。
 */
export function solveLayout(
    world: StageWorld,
    entities: StageEntity[],
    relations: SpatialRelation[],
    seed?: Map<string, [number, number, number]>,
): EntityTransform[] {
    const byId = new Map(entities.map((e) => [e.id, e]));
    const graph = new RelationGraph(entities, relations);
    const pos = new Map<string, Pt>();

    // ---- 初始化 ----
    entities.forEach((e, i) => {
        const s = seed?.get(e.id);
        if (s) {
            pos.set(e.id, { x: s[0], y: s[1], z: s[2] });
            return;
        }
        const angle = (i / Math.max(1, entities.length)) * Math.PI * 2;
        pos.set(e.id, {
            x: Math.cos(angle) * 1.5,
            y: sizeOf(e.sizeClass)[1] / 2,
            z: Math.sin(angle) * 1.5,
        });
    });

    const attached = new Set<string>(); // 被 on_top_of/holds 锁定的实体，跳过 x-z 松弛
    for (const e of entities) {
        if (graph.supporterOf(e.id)) attached.add(e.id);
    }

    // ---- x-z 松弛 ----
    const halfW = world.floor_width / 2;
    const halfD = world.floor_depth / 2;

    for (let it = 0; it < ITER; it++) {
        for (const r of relations) {
            const a = pos.get(r.subject);
            const b = pos.get(r.object);
            const ea = byId.get(r.subject);
            const eb = byId.get(r.object);
            if (!a || !b || !ea || !eb) continue;
            if (attached.has(r.subject)) continue;

            const gapX = radiusX(ea) + radiusX(eb) + MARGIN;
            const gapZ = radiusZ(ea) + radiusZ(eb) + MARGIN;

            switch (r.relation) {
                case "left_of":     enforceAxis(a, b, "x", b.x - a.x, gapX); break;
                case "right_of":    enforceAxis(b, a, "x", a.x - b.x, gapX); break;
                case "in_front_of": enforceAxis(b, a, "z", a.z - b.z, gapZ); break;
                case "behind":      enforceAxis(a, b, "z", b.z - a.z, gapZ); break;
                case "near":        pull(a, b, NEAR_DIST); break;
                case "next_to":     pull(a, b, NEXT_DIST); break;
                case "at":          pull(a, b, planarRadius(ea) + planarRadius(eb)); break;
                default: break; // on_top_of / holds 后处理
            }
        }

        // 防重叠
        for (let i = 0; i < entities.length; i++) {
            for (let j = i + 1; j < entities.length; j++) {
                const A = entities[i], B = entities[j];
                if (attached.has(A.id) || attached.has(B.id)) continue;
                separate(pos.get(A.id)!, pos.get(B.id)!, planarRadius(A) + planarRadius(B));
            }
        }

        // 夹到世界边界
        for (const e of entities) {
            const p = pos.get(e.id)!;
            p.x = clamp(p.x, -halfW + radiusX(e), halfW - radiusX(e));
            p.z = clamp(p.z, -halfD + radiusZ(e), halfD - radiusZ(e));
        }
    }

    // ---- y：堆叠链自底向上 ----
    for (const id of graph.supportOrder()) {
        const e = byId.get(id);
        if (!e) continue;
        const p = pos.get(id)!;
        const supporter = graph.supporterOf(id);
        if (supporter && pos.get(supporter)) {
            const sp = pos.get(supporter)!;
            const se = byId.get(supporter)!;
            p.x = sp.x;
            p.z = sp.z + 0.3; // 持有物略靠前
            p.y = sp.y + sizeOf(se.sizeClass)[1] / 2 + sizeOf(e.sizeClass)[1] / 2;
        } else {
            p.y = sizeOf(e.sizeClass)[1] / 2; // 落地
        }
    }

    return entities.map((e) => {
        const p = pos.get(e.id)!;
        return {
            id: e.id,
            position: [round(p.x), round(p.y), round(p.z)],
            facing: 0, // v1 默认面向 +z；后续由 beat 的 new_facing 精修
            size: sizeOf(e.sizeClass),
        };
    });
}

/**
 * 从基准布局出发，叠加某节拍的关系，重新解算该节拍快照。
 */
export function resolveBeatLayout(
    world: StageWorld,
    entities: StageEntity[],
    baseRelations: SpatialRelation[],
    beatRelations: SpatialRelation[],
    base: EntityTransform[],
): EntityTransform[] {
    const seed = new Map<string, [number, number, number]>(
        base.map((t) => [t.id, t.position]),
    );
    return solveLayout(world, entities, [...baseRelations, ...beatRelations], seed);
}

// ---- helpers ----

/** 强制 hi 在 lo 之上（同轴），要求 cur = (hi[axis]-lo[axis]) >= gap */
function enforceAxis(lo: Pt, hi: Pt, axis: "x" | "z", cur: number, gap: number): void {
    if (cur >= gap) return;
    const corr = (gap - cur) * DAMP;
    lo[axis] -= corr / 2;
    hi[axis] += corr / 2;
}

function pull(a: Pt, b: Pt, target: number): void {
    const dx = b.x - a.x, dz = b.z - a.z;
    const d = Math.hypot(dx, dz) || 1e-6;
    if (d <= target) return;
    const corr = (d - target) * DAMP;
    const ux = dx / d, uz = dz / d;
    a.x += ux * corr / 2; a.z += uz * corr / 2;
    b.x -= ux * corr / 2; b.z -= uz * corr / 2;
}

function separate(a: Pt, b: Pt, minDist: number): void {
    const dx = a.x - b.x, dz = a.z - b.z;
    const d = Math.hypot(dx, dz) || 1e-6;
    if (d >= minDist) return;
    const corr = (minDist - d) * 0.5;
    const ux = dx / d, uz = dz / d;
    a.x += ux * corr; a.z += uz * corr;
    b.x -= ux * corr; b.z -= uz * corr;
}

function clamp(v: number, lo: number, hi: number): number {
    return Math.max(lo, Math.min(hi, v));
}
function round(v: number): number { return Math.round(v * 100) / 100; }