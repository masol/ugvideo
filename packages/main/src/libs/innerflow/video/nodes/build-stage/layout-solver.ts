// nodes/build-stage/layout-solver.ts
import { RelationGraph } from "./relation-graph.js";
import { sizeOf, type EntityTransform, type SpatialRelation, type StageEntity, type StageWorld } from "./types.js";

interface Pt { x: number; y: number; z: number; }

// 梦境级物理：少量迭代满足拓扑即可，不做精细约束求解
const ITER = 48;
const DAMP = 0.3;
const MARGIN = 0.3;
const NEAR = 0.9;
const NEXT = 0.55;
const HAND_HEIGHT = 1.0; // 持有物默认手部高度

function rX(e: StageEntity): number { return sizeOf(e.sizeClass)[0] / 2; }
function rZ(e: StageEntity): number { return sizeOf(e.sizeClass)[2] / 2; }
function planarR(e: StageEntity): number {
    const s = sizeOf(e.sizeClass);
    return Math.max(s[0], s[2]) / 2;
}

/**
 * 拓扑关系 → 粗略 3D 坐标。
 * 附着物（on_top_of / holds 的从属方）跳过平面松弛，由后处理定位。
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

    entities.forEach((e, i) => {
        const s = seed?.get(e.id);
        if (s) { pos.set(e.id, { x: s[0], y: s[1], z: s[2] }); return; }
        const a = (i / Math.max(1, entities.length)) * Math.PI * 2;
        pos.set(e.id, { x: Math.cos(a) * 1.5, y: sizeOf(e.sizeClass)[1] / 2, z: Math.sin(a) * 1.5 });
    });

    // 附着方：被堆叠或被持有的实体，平面位置由后处理决定
    const attached = new Set<string>();
    for (const e of entities) {
        if (graph.stackBaseOf(e.id) || graph.holderOf(e.id)) attached.add(e.id);
    }

    const halfW = world.floor_width / 2;
    const halfD = world.floor_depth / 2;

    for (let it = 0; it < ITER; it++) {
        for (const r of relations) {
            const a = pos.get(r.subject), b = pos.get(r.object);
            const ea = byId.get(r.subject), eb = byId.get(r.object);
            if (!a || !b || !ea || !eb || attached.has(r.subject)) continue;
            const gapX = rX(ea) + rX(eb) + MARGIN;
            const gapZ = rZ(ea) + rZ(eb) + MARGIN;
            switch (r.relation) {
                case "left_of": enforce(a, b, "x", b.x - a.x, gapX); break;
                case "right_of": enforce(b, a, "x", a.x - b.x, gapX); break;
                case "in_front_of": enforce(b, a, "z", a.z - b.z, gapZ); break;
                case "behind": enforce(a, b, "z", b.z - a.z, gapZ); break;
                case "near": pull(a, b, NEAR); break;
                case "next_to": pull(a, b, NEXT); break;
                case "at": pull(a, b, planarR(ea) + planarR(eb)); break;
                default: break; // on_top_of / holds 后处理
            }
        }
        for (let i = 0; i < entities.length; i++) {
            for (let j = i + 1; j < entities.length; j++) {
                const A = entities[i], B = entities[j];
                if (attached.has(A.id) || attached.has(B.id)) continue;
                separate(pos.get(A.id)!, pos.get(B.id)!, planarR(A) + planarR(B));
            }
        }
        for (const e of entities) {
            const p = pos.get(e.id)!;
            p.x = clamp(p.x, -halfW + rX(e), halfW - rX(e));
            p.z = clamp(p.z, -halfD + rZ(e), halfD - rZ(e));
        }
    }

    // on_top_of：自底向上定高
    for (const id of graph.stackOrder()) {
        const e = byId.get(id); if (!e) continue;
        const base = graph.stackBaseOf(id);
        const p = pos.get(id)!;
        if (base && pos.get(base)) {
            const bp = pos.get(base)!, be = byId.get(base)!;
            p.x = bp.x; p.z = bp.z;
            p.y = bp.y + sizeOf(be.sizeClass)[1] / 2 + sizeOf(e.sizeClass)[1] / 2;
        } else {
            p.y = sizeOf(e.sizeClass)[1] / 2;
        }
    }

    // holds：附着到持有者手部（不堆到头顶）
    for (const e of entities) {
        const holder = graph.holderOf(e.id);
        if (!holder || !pos.get(holder)) continue;
        const hp = pos.get(holder)!;
        const p = pos.get(e.id)!;
        p.x = hp.x + 0.2;      // 略偏一侧（左右手细节由 beat 记录，坐标粗放即可）
        p.z = hp.z + 0.25;     // 略靠前
        p.y = HAND_HEIGHT;
    }

    return entities.map((e) => {
        const p = pos.get(e.id)!;
        return { id: e.id, position: [round(p.x), round(p.y), round(p.z)], facing: 0, size: sizeOf(e.sizeClass) };
    });
}

/** 从基准布局叠加某节拍关系，重解算该拍快照（供未来分镜阶段） */
export function resolveBeatLayout(
    world: StageWorld,
    entities: StageEntity[],
    baseRelations: SpatialRelation[],
    beatRelations: SpatialRelation[],
    base: EntityTransform[],
): EntityTransform[] {
    const seed = new Map<string, [number, number, number]>(base.map((t) => [t.id, t.position]));
    return solveLayout(world, entities, [...baseRelations, ...beatRelations], seed);
}

// ---- helpers ----
function enforce(lo: Pt, hi: Pt, axis: "x" | "z", cur: number, gap: number): void {
    if (cur >= gap) return;
    const c = (gap - cur) * DAMP;
    lo[axis] -= c / 2; hi[axis] += c / 2;
}
function pull(a: Pt, b: Pt, target: number): void {
    const dx = b.x - a.x, dz = b.z - a.z;
    const d = Math.hypot(dx, dz) || 1e-6;
    if (d <= target) return;
    const c = (d - target) * DAMP, ux = dx / d, uz = dz / d;
    a.x += ux * c / 2; a.z += uz * c / 2; b.x -= ux * c / 2; b.z -= uz * c / 2;
}
function separate(a: Pt, b: Pt, min: number): void {
    const dx = a.x - b.x, dz = a.z - b.z;
    const d = Math.hypot(dx, dz) || 1e-6;
    if (d >= min) return;
    const c = (min - d) * 0.5, ux = dx / d, uz = dz / d;
    a.x += ux * c; a.z += uz * c; b.x -= ux * c; b.z -= uz * c;
}
function clamp(v: number, lo: number, hi: number): number { return Math.max(lo, Math.min(hi, v)); }
function round(v: number): number { return Math.round(v * 100) / 100; }