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

export interface GlobalEntity {
    /** 规范名 = 原文名称（同名不同实体加定语区分） */
    name: string;
    kind: EntityKind;
    /** 首次出场时原文中的外观（供跨场景对齐比对；原文无则空串） */
    appearance: string;
    /** 出场场景 id 列表（叙事顺序） */
    scenes: string[];
    /** 是否具有类人外观（人形角色/拟人化生物=true；纯兽/纯物件=false） */
    humanoid: boolean;
    /** 数量：1=个体，>1=群体（如"三名士兵"=3），0=不确定数量的群体 */
    count: number;
    /**
     * 出生方式（仅 prop/set 有意义）。
     * "scene" = 场景固有；"character:角色名" = 由角色带入/持有。
     * character/light 类固定为 "scene"（无意义但统一类型）。
     */
    origin: EntityOrigin;
    /**
     * 场景快照索引：每个出场场景对应一条快照记录（指向 design-characters 产出的 costume_ref）。
     * 用于下游按场景隔离生成参考图。
     */
    scene_snapshots?: SceneSnapshotRef[];
    /**
     * 时间跳跃标记：key=sceneId, value=true 表示与上一场景存在显著时间间隔（换装/衰老/伤痕需要重新判定）。
     */
    time_skips?: Record<string, boolean>;
}

export interface SceneSnapshotRef {
    scene_id: string;
    /** design-characters 产出的 costume key（char:costume_{name}_{sceneId}） */
    costume_ref: string;
    /** 时间跳跃后是否需要换装/衰老/伤痕 */
    requires_redress: boolean;
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
    /** 是否具有类人外观；仅 character 类型有意义，其余填 false */
    humanoid: boolean;
    /** 数量：1=个体，>1=群体，0=不确定数量的群体 */
    count: number;
    /**
     * 来源群体名称。若该实体是从某群体中提升出的独立个体，
     * 填来源群体的名称（如"士兵们"）；否则为 undefined/null。
     */
    source_group?: string | null;
    /**
     * 出生方式（仅 prop/set 有意义）。
     * "scene" = 场景固有（开场即在，是环境的一部分）；
     * "character:角色名" = 由角色带入/持有/催生。
     */
    origin?: EntityOrigin;
    /**
     * 穿着者（仅 prop 有意义）。
     * 非 null 表示该 prop 是穿在某角色身上/正在穿戴的衣物或配饰，
     * 其视觉表现由该角色的定妆照（costume / 角色参考图）覆盖。
     * 对齐阶段会把该 prop 从 prop 集合剔除，并将其外观特征合并到对应角色的 scene_delta。
     * character/set/light 类固定为 null。
     */
    worn_by?: string | null;
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