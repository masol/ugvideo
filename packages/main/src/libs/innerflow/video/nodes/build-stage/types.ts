// nodes/build-stage/types.ts

export type EntityKind = "character" | "prop" | "set" | "light";

export type Hand = "left" | "right" | "both";

//============================================================
// 全局实体登记册（跨场景身份 + 出图记忆）
// ============================================================

export interface EntityImageRef {
    scene_id: string;
    beat_index?: number;
    asset_key: string;   // 指向asset:* 的KV key（真正URL 由出图节点写）
    is_anchor: boolean;  // 锚定首图；二次出图索引它做一致性
}

export interface GlobalEntity {
    gid: string;                // C01/P01/L01/LT01
    kind: EntityKind;
    name: string;
    aliases: string[];
    /** T2I 可直接复用的 canonical外观 */
    canonical_appearance: string;
    /**跨场景稳定识别特征，供对齐匹配 */
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
    /** 本场首次可见外观（新建全局实体时作canonical初值） */
    appearance: string;
    /** 跨场景稳定识别特征，供对齐 */
    alignment_hint: string;
    /** 本场景相对canonical 的差异（伤痕/破损/沾染） */
    scene_overrides?: string;
}

export interface StageWorld {
    scene_id: string;
    /** 布景环境 NL：地点/光线/色调/材质/氛围 */
    environment: string;
    /** 主光基调 NL：方向/色温/软硬 */
    key_light: string;
}

export interface SceneStage {
    world: StageWorld;
    entities: StageEntity[];
    /** 开场瞬间所有实体的相对位置与姿态，自然语言（无词表限制） */
    spatial_layout: string;
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
    /** 本拍站位/空间变化的自然语言描述；无变化则 undefined */
    staging?: string;
    deltas: BeatDelta[];
}