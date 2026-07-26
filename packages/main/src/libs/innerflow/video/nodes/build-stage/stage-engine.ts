// nodes/build-stage/stage-engine.ts
import { Box3, Frustum, Matrix4, PerspectiveCamera, Ray, Vector3 } from "three";
import type { EntityKind, EntityTransform } from "./types.js";

export interface ShotSpec {
    camera_pos: [number, number, number];
    look_at: [number, number, number];
    fov: number;      // 垂直视场角（度）
    aspect: number;   // 画幅比，如 16/9
}

export interface FramedEntity {
    id: string;
    in_frame: boolean;
    occluded: boolean;
    screen_box: { min_u: number; min_v: number; max_u: number; max_v: number };
    screen_center: { u: number; v: number };
    coverage: number;                       // 占画幅面积比例
    horizontal: "left" | "center" | "right";
    vertical: "top" | "middle" | "bottom";
    distance: number;                       // 到机位距离
}

export interface ShotResult {
    framed: FramedEntity[];
    visible_ids: string[];
    /** 3x3 网格中无实体中心的空区提示（如 "左上"、"正下"） */
    empty_zones: string[];
}

interface EngineEntity {
    id: string;
    kind: EntityKind;
    box: Box3;
    center: Vector3;
}

/**
 * 导演台 3D 引擎：承载解算后的实体变换，负责相机视锥体、画幅投影、遮挡演算。
 * v1 提供 computeShot；后续可细化焦距↔FOV 转换、软遮挡、构图评分。
 */
export class DirectorStage {
    private entities: EngineEntity[] = [];

    constructor(transforms: EntityTransform[], kinds: Map<string, EntityKind>) {
        for (const t of transforms) {
            const [x, y, z] = t.position;
            const [sx, sy, sz] = t.size;
            const box = new Box3(
                new Vector3(x - sx / 2, y - sy / 2, z - sz / 2),
                new Vector3(x + sx / 2, y + sy / 2, z + sz / 2),
            );
            this.entities.push({
                id: t.id,
                kind: kinds.get(t.id) ?? "prop",
                box,
                center: new Vector3(x, y, z),
            });
        }
    }

    computeShot(spec: ShotSpec): ShotResult {
        const cam = new PerspectiveCamera(spec.fov, spec.aspect, 0.05, 500);
        cam.position.set(...spec.camera_pos);
        cam.lookAt(new Vector3(...spec.look_at));
        cam.updateMatrixWorld(true);
        cam.updateProjectionMatrix();

        const frustum = new Frustum();
        const m = new Matrix4().multiplyMatrices(
            cam.projectionMatrix,
            cam.matrixWorldInverse,
        );
        frustum.setFromProjectionMatrix(m);

        const framed: FramedEntity[] = [];
        const visible: string[] = [];
        const occupancy = new Set<string>(); // 3x3 网格占用

        for (const ent of this.entities) {
            const inFrame = frustum.intersectsBox(ent.box);
            const proj = projectBox(ent.box, cam);
            const occluded = inFrame ? this.isOccluded(cam.position, ent) : false;

            const box = {
                min_u: clamp01(proj.minU),
                min_v: clamp01(proj.minV),
                max_u: clamp01(proj.maxU),
                max_v: clamp01(proj.maxV),
            };
            const cu = (box.min_u + box.max_u) / 2;
            const cv = (box.min_v + box.max_v) / 2;
            const coverage =
                Math.max(0, box.max_u - box.min_u) * Math.max(0, box.max_v - box.min_v);

            if (inFrame && !occluded) {
                visible.push(ent.id);
                occupancy.add(gridCell(cu, cv));
            }

            framed.push({
                id: ent.id,
                in_frame: inFrame,
                occluded,
                screen_box: box,
                screen_center: { u: round(cu), v: round(cv) },
                coverage: round(coverage),
                horizontal: cu < 0.38 ? "left" : cu > 0.62 ? "right" : "center",
                vertical: cv < 0.38 ? "top" : cv > 0.62 ? "bottom" : "middle",
                distance: round(cam.position.distanceTo(ent.center)),
            });
        }

        return { framed, visible_ids: visible, empty_zones: emptyZones(occupancy) };
    }

    /** 从机位到实体中心射线，检查是否被其它实体包围盒挡住 */
    private isOccluded(camPos: Vector3, target: EngineEntity): boolean {
        const dir = target.center.clone().sub(camPos);
        const distToTarget = dir.length();
        dir.normalize();
        const ray = new Ray(camPos, dir);
        const hit = new Vector3();
        for (const other of this.entities) {
            if (other.id === target.id) continue;
            const p = ray.intersectBox(other.box, hit);
            if (p && camPos.distanceTo(p) < distToTarget - 0.05) return true;
        }
        return false;
    }
}

// ---- helpers ----

function projectBox(box: Box3, cam: PerspectiveCamera) {
    const corners = [
        new Vector3(box.min.x, box.min.y, box.min.z),
        new Vector3(box.min.x, box.min.y, box.max.z),
        new Vector3(box.min.x, box.max.y, box.min.z),
        new Vector3(box.min.x, box.max.y, box.max.z),
        new Vector3(box.max.x, box.min.y, box.min.z),
        new Vector3(box.max.x, box.min.y, box.max.z),
        new Vector3(box.max.x, box.max.y, box.min.z),
        new Vector3(box.max.x, box.max.y, box.max.z),
    ];
    let minU = Infinity, minV = Infinity, maxU = -Infinity, maxV = -Infinity;
    for (const c of corners) {
        const p = c.clone().project(cam); // NDC [-1,1]
        const u = (p.x + 1) / 2;
        const v = (1 - p.y) / 2; // 上为 0
        minU = Math.min(minU, u); maxU = Math.max(maxU, u);
        minV = Math.min(minV, v); maxV = Math.max(maxV, v);
    }
    return { minU, minV, maxU, maxV };
}

function gridCell(u: number, v: number): string {
    const col = u < 1 / 3 ? 0 : u < 2 / 3 ? 1 : 2;
    const row = v < 1 / 3 ? 0 : v < 2 / 3 ? 1 : 2;
    return `${row}-${col}`;
}

function emptyZones(occ: Set<string>): string[] {
    const rows = ["上", "中", "下"];
    const cols = ["左", "中", "右"];
    const out: string[] = [];
    for (let r = 0; r < 3; r++) {
        for (let c = 0; c < 3; c++) {
            if (!occ.has(`${r}-${c}`)) out.push(`${rows[r]}${cols[c]}`);
        }
    }
    return out;
}

function clamp01(v: number): number { return Math.max(0, Math.min(1, v)); }
function round(v: number): number { return Math.round(v * 1000) / 1000; }