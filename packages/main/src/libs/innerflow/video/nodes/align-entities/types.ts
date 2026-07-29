// nodes/align-entities/types.ts

export type EntityKind = "character" | "prop" | "set" | "light";

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