// nodes/build-stage/types.ts

export type EntityKind = "character" | "prop" | "set" | "light";

// ============================================================
// 全局实体登记册（跨场景身份）
//   以原文名称为规范键；只记忠实信息与出场场景，不做几何、不存图历史。
// ============================================================

export interface GlobalEntity {
    /** 规范名 = 原文名称（同名不同实体加定语区分） */
    name: string;
    kind: EntityKind;
    /** 首次出场时原文中的外观（供跨场景对齐比对；原文无则空串） */
    appearance: string;
    /** 出场场景 id 列表（叙事顺序） */
    scenes: string[];
}

// ============================================================
// 场景静态舞台（忠实抽取，无坐标）
// ============================================================

export interface StageEntity {
    /** 原文名称，本场景内唯一（同名实体加定语区分） */
    name: string;
    kind: EntityKind;
    /** 原文对该实体的外观描写；原文没写则 null（不臆造） */
    appearance: string | null;
}

export interface StageWorld {
    scene_id: string;
    /** 原文环境描写：地点/室内外/陈设/材质/氛围 */
    environment: string;
    /** 原文光线/时间线索（日/夜/烛光/雨天等）；无则 null，不推断方向色温 */
    key_light: string | null;
}

export interface SceneStage {
    world: StageWorld;
    entities: StageEntity[];
    /** 开场瞬间实体相对位置与姿态（自然语言，无词表限制）；原文无则 null */
    spatial_layout: string | null;
}

// ============================================================
// 节拍时间线（动态变化）
// ============================================================

export interface BeatDelta {
    /** 实体名，必须来自本场实体清单 */
    entity: string;
    /** 本拍视觉可见动作（原文所述）；无则 null */
    action: string | null;
    /** 本拍台词原文；无则 null */
    dialogue: string | null;
    /** 本拍外观/状态增量（伤痕/沾染/破损）；无则 null */
    state_change: string | null;
    /** 本拍该个体情绪（TTS 语气来源）；读不出则 null */
    emotion: string | null;
}

export interface Beat {
    index: number;
    /** 语义时长（约Ns）；无法判断则 null */
    duration_hint: string | null;
    summary: string;
    /** 本拍整体情绪基调；读不出则 null */
    mood: string | null;
    /** 本拍站位/关系变化（移动、持有变化、位置改变）；无变化则 null */
    staging: string | null;
    /** 本拍有动静的实体 */
    deltas: BeatDelta[];
}