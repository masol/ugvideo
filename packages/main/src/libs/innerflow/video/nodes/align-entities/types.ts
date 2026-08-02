// nodes/align-entities/types.ts

export type EntityKind = "character" | "prop" | "set" | "light";

/**
 * 道具/陈设的出生方式：
 * - "scene" — 场景固有（桌上的茶壶、墙上的画、地面的法盆），开场即在，属于环境的一部分
 * - "character:角色名" — 由某角色带入/持有/催生（角色的武器、随身物品、中途掏出的道具）
 */
export type EntityOrigin = "scene" | `character:${string}`;

// ============================================================
// 全局实体登记册（跨场景身份）
// ============================================================

/**
 * 对齐语义字段。registry 在 align 阶段之后即稳定，gate 视为只读上游。
 *
 * 注意：本接口不再包含 time_skips 和 scene_snapshots。
 * 这两类派生标记已搬到独立 KV：
 *   - time_skips      → Storage.timeSkipsKey(name)
 *   - scene_snapshots → Storage.snapshotsKey(name)
 *
 * 设计原因：这两类标记由 audit 之后的步骤（scanTimeSkips / design-characters 回调）
 * 写入，会刷新 GlobalEntity 的 updatedAt，进而污染以 registry 作为 gate input 的
 * 审计节点，导致每次重跑都触发审计 LLM。
 *
 * 遵循规则："gate input 必须只读（read-only-after-gate）"——
 * 任何在 gate 之后的步骤都不得修改 gate input 指向的 KV。
 */
export interface GlobalEntity {
    name: string;
    kind: EntityKind;
    appearance: string;
    scenes: string[];
    humanoid: boolean;
    count: number;
    origin: EntityOrigin;
}

export interface SceneSnapshotRef {
    scene_id: string;
    costume_ref: string;
    requires_redress: boolean;
}

// ============================================================
// 场景静态舞台（忠实抽取，无坐标）
// ============================================================

export interface StageEntity {
    name: string;
    kind: EntityKind;
    appearance: string | null;
    humanoid: boolean;
    count: number;
    source_group?: string | null;
    origin?: EntityOrigin;
    worn_by?: string | null;
}

export interface StageWorld {
    scene_id: string;
    environment: string;
    key_light: string | null;
}

export interface SceneStage {
    world: StageWorld;
    entities: StageEntity[];
    spatial_layout: string | null;
}