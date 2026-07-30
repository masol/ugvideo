// nodes/design-characters/types.ts

/** 角色身份推断结果 */
export interface CharacterIdentity {
    /** 全局规范名 */
    name: string;
    /** 角色身份描述（一句话：职业/阶层/社会角色） */
    identity: string;
    /** 族裔（显式给出，防止渲染漂移） */
    ethnicity: string;
    /** 年龄段 */
    age_stage: string;
    /** 性别 */
    gender: "male" | "female" | "androgynous" | "unknown";
    /** 体型关键词（AI引擎友好） */
    body_type: string;
}

/** 服装设计结果 */
export interface CostumeDesign {
    /** 关联角色规范名 */
    character_name: string;
    /** 服装整体描述（AI引擎友好，含材质+色彩+构件） */
    description: string;
    /** 时代/文化参照 */
    era_reference: string;
    /** 廓形关键词（英文，3-5个） */
    silhouette_keywords_en: string[];
    /** 逐构件描述 */
    items: CostumeItem[];
}

export interface CostumeItem {
    layer: "outer" | "mid" | "base" | "underlayer" | "footwear" | "headwear" | "accessory";
    item: string;
    silhouette: string;
    material: string;
    color: string;
    pattern: string | null;
    key_detail: string | null;
}

/** 制服设计结果（群体共用） */
export interface UniformDesign {
    /** 制服名称（如"禁卫军甲胄"） */
    uniform_name: string;
    /** 关联的群体实体规范名 */
    group_entity_name: string;
    /** 服装整体描述 */
    description: string;
    /** 时代/文化参照 */
    era_reference: string;
    /** 廓形关键词 */
    silhouette_keywords_en: string[];
    /** 逐构件 */
    items: CostumeItem[];
    /** 穿着者性别 */
    wearer_gender: "male" | "female" | "androgynous";
    /** 穿着者体型 */
    wearer_body_type: string;
}

/** 渲染策略 */
export type RenderStrategy =
    | "individual_refsheet"   // 单人定妆照（跨场景出现或有台词/关键动作）
    | "uniform_refsheet"      // 制服三视图（群体且穿制式服装）
    | "prompt_only"           // 仅提示词描述（次要/背景，由I2V自行渲染）
    | "skip";                 // 不渲染（光源等）

/** 实体渲染决策 */
export interface EntityRenderDecision {
    /** 全局规范名 */
    name: string;
    /** 实体类别 */
    kind: string;
    /** 渲染策略 */
    strategy: RenderStrategy;
    /** 重要度（0-10，跨场景无条件高重要度） */
    importance: number;
    /** 若 strategy=uniform_refsheet，关联的制服名称 */
    uniform_name?: string;
    /** 简短理由 */
    rationale: string;
}