// nodes/build-stage/types.ts

export type EntityKind = "character" | "prop" | "set" | "light";

/** 粗尺寸桶：只有大件（家具/布景）才真正参与遮挡；小件仅占位 */
export type SizeClass =
    | "human"
    | "small_prop"
    | "medium_prop"
    | "large_prop"
    | "furniture"
    | "set_piece"
    | "point_light"
    | "area_light";

/** 尺寸桶 → 包围盒 [宽(x), 高(y), 深(z)]（米） */
export const SIZE_TABLE: Record<SizeClass, [number, number, number]> = {
    human: [0.5, 1.7, 0.35],
    small_prop: [0.15, 0.15, 0.15],
    medium_prop: [0.4, 0.4, 0.4],
    large_prop: [0.8, 1.0, 0.8],
    furniture: [1.2, 0.8, 0.6],
    set_piece: [2.0, 2.5, 0.4],
    point_light: [0.2, 0.2, 0.2],
    area_light: [1.0, 1.0, 0.2],
};

export function sizeOf(cls: SizeClass): [number, number, number] {
    return SIZE_TABLE[cls] ?? SIZE_TABLE.medium_prop;
}

/**
 * 坐标系（世界/舞台系，单位米，梦境级物理）：
 *   +x=右  -x=左  +z=靠前(近机位)  -z=靠后  +y=上
 * 只保证「视角范围内拓扑自洽」，不追求物理精确。
 */
export type RelationKind =
    | "left_of"
    | "right_of"
    | "in_front_of"
    | "behind"
    | "on_top_of"    // subject 竖直堆叠在 object 之上
    | "near"
    | "next_to"
    | "holds"        // subject 持有 object（附着到 subject 手部）
    | "at";          // subject 位于 object（某布景）处

export type Hand = "left" | "right" | "both";

export interface SpatialRelation {
    subject: string;   // entity id
    relation: RelationKind;
    object: string;    // entity id
    hand?: Hand;       // 仅 holds 关系使用
    note?: string;
}

// ============================================================
// 全局实体登记册（跨场景身份 + 出图记忆）
// ============================================================

export interface EntityImageRef {
    scene_id: string;
    beat_index?: number;
    asset_key: string;   // 指向 asset:* 的 KV key（真正 URL 由出图节点写）
    is_anchor: boolean;  // 锚定首图；二次出图索引它做一致性
}

export interface GlobalEntity {
    gid: string;                 // C01/P01/L01/LT01
    kind: EntityKind;
    name: string;
    aliases: string[];
    size_class: SizeClass;
    /** T2I 可直接复用的 canonical 外观 */
    canonical_appearance: string;
    /** 跨场景稳定识别特征，供对齐匹配 */
    alignment_desc: string;
    first_scene: string;
    image_history: EntityImageRef[];
}

// ============================================================
// 场景静态舞台
// ============================================================

export interface StageEntity {
    id: string;                // 场景内局部 id，如 e01
    ref?: string;              // 对齐后指向 registry 的 gid
    kind: EntityKind;
    label: string;
    sizeClass: SizeClass;
    /** 本场首次可见外观（新建全局实体时作 canonical 初值） */
    appearance: string;
    /** 跨场景稳定识别特征，供对齐 */
    alignment_hint: string;
    /** 本场景相对 canonical 的差异（伤痕/破损/沾染） */
    scene_overrides?: string;
}

export interface EntityTransform {
    id: string;
    position: [number, number, number];
    facing: number;                     // 偏航角(度)，0=面向+z
    size: [number, number, number];
}

export interface StageWorld {
    scene_id: string;
    environment: string;   // 布景 NL
    floor_width: number;   // x
    floor_depth: number;   // z
    ceiling_height: number;// y
    key_light: string;     // 主光基调 NL：方向/色温/软硬
}

export interface SceneStage {
    world: StageWorld;
    entities: StageEntity[];
    base_layout: EntityTransform[];  // 开场基准布局
}

// ============================================================
// 节拍时间线（动态变化，独立表）
// ============================================================

export interface BeatHold {
    object_id: string;
    hand?: Hand;
}

export interface BeatDelta {
    entity_id: string;
    action?: string;
    dialogue?: string;
    holds?: BeatHold[];
    moves_to?: string;
    new_facing?: string;
    /** 本拍视觉状态增量（累积成实体当前状态） */
    appearance_change?: string;
    /** 该个体本拍情绪（TTS 语气来源） */
    mood?: string;
}

export interface Beat {
    index: number;
    duration_hint?: string;
    summary: string;
    mood?: string;
    relations: SpatialRelation[];
    deltas: BeatDelta[];
}