// nodes/design-characters/types.ts

export interface CharacterIdentity {
    name: string;
    identity: string;
    ethnicity: string;
    age_stage: string;
    gender: "male" | "female" | "androgynous" | "unknown";
    body_type: string;
}

export interface CostumeDesign {
    character_name: string;
    description: string;
    era_reference: string;
    silhouette_keywords_en: string[];
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

export interface UniformDesign {
    uniform_name: string;
    group_entity_name: string;
    description: string;
    era_reference: string;
    silhouette_keywords_en: string[];
    items: CostumeItem[];
    wearer_gender: "male" | "female" | "androgynous";
    wearer_body_type: string;
}

export type RenderStrategy =
    | "individual_refsheet"
    | "uniform_refsheet"
    | "group_photo"
    | "prompt_only"
    | "skip";

export interface EntityRenderDecision {
    /** 实体规范名（不含 sceneId，sceneId 在外层管理） */
    name: string;
    kind: string;
    strategy: RenderStrategy;
    importance: number;
    uniform_name?: string;
    rationale: string;
    /** 所属场景 id（按场景隔离时使用） */
    scene_id?: string;
    referenced_shot_count: number;
    referenced_scene_count: number;
    is_static_in_scene: boolean;
    source_group?: string;
    /** 出生方式（从 align-entities 透传） */
    origin: string;
}