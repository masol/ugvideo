// nodes/build-stage/types.ts

export type EntityKind = "character" | "prop" | "set" | "light";

/** 粗尺寸桶，求解器据此给出包围盒尺寸（米） */
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

export interface StageEntity {
    /** 场景内稳定 id，如 "e01" */
    id: string;
    kind: EntityKind;
    /** 名称/标签，如 "林夏"、"左轮手枪" */
    label: string;
    /** 后续可挂 canonical entity id */
    ref?: string;
    sizeClass: SizeClass;
}

/**
 * 坐标系约定（世界/舞台系，单位米）：
 *   +x = 舞台右侧    -x = 舞台左侧
 *   +z = 靠前/朝向默认机位（下场门方向）   -z = 靠后
 *   +y = 上
 */
export type RelationKind =
    | "left_of"      // subject 在 object 左侧
    | "right_of"     // subject 在 object 右侧
    | "in_front_of"  // subject 在 object 前方（更靠近机位）
    | "behind"       // subject 在 object 后方
    | "on_top_of"    // subject 位于 object 之上（堆叠）
    | "near"         // 靠近
    | "next_to"      // 紧邻
    | "holds"        // subject 持有 object（附着）
    | "at";          // subject 位于 object（某布景）处

export interface SpatialRelation {
    subject: string;   // entity id
    relation: RelationKind;
    object: string;    // entity id
    note?: string;
}

export interface BeatDelta {
    entity_id: string;
    action?: string;       // 行为动作（自然语言）
    dialogue?: string;     // 台词
    moves_to?: string;     // 目标 entity id（或自由描述）
    new_facing?: string;   // "面向 e02" 等
}

export interface Beat {
    index: number;
    summary: string;
    /** 本节拍新增/变化的空间关系 */
    relations: SpatialRelation[];
    /** 每个个体独立的动作/台词（可并行） */
    deltas: BeatDelta[];
}

export interface StageWorld {
    scene_id: string;
    environment: string;   // 布景自然语言描述
    floor_width: number;   // x 向尺寸
    floor_depth: number;   // z 向尺寸
    ceiling_height: number;// y 向尺寸
}

/** 某节拍快照下单个实体的解算变换 */
export interface EntityTransform {
    id: string;
    position: [number, number, number];
    facing: number;                     // 偏航角（度），0 = 面向 +z
    size: [number, number, number];
}

/** 一个场景对应一个完整导演台 */
export interface SceneStage {
    world: StageWorld;
    entities: StageEntity[];
    beats: Beat[];
    /** beat 0 的解算基准布局 */
    base_layout: EntityTransform[];
}