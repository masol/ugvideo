// nodes/design-characters/types.ts

export interface CharacterIdentity {
    name: string;
    identity: string;
    ethnicity: string;
    age_stage: string;
    gender: "male" | "female" | "androgynous" | "unknown";
    body_type: string;
    /**
     * 是否穿着制式统一的服装。
     * 仅对「人类群体角色」有意义（仵作/禁军/镖师 = true；老幼混杂家庭/临时聚合人群 = false）。
     * 个体角色、非人类角色一律为 null（语义不适用）。
     */
    uniformed: boolean | null;
    /**
     * 该个体在语义上所归属的制服化群体名（用于让独立抽取的成员套用群体制服）。
     * 仅对「独立抽取、但语义上属于某制服化群体的人类个体」有意义（如 仵作甲 → 仵作众人）。
     * 不属于任何群体、群体本身、或非人类角色一律为 null。
     */
    group_member_of: string | null;
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