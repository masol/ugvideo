// nodes/generate-reference-images/types.ts

export type RefsheetLayout =
    | "four_column"
    | "three_column"
    | "magazine_grid"
    | "uniform_turnaround"
    | "group_photo";

export type EntitySpatialRole = "fixed_set" | "dynamic_prop" | "off_scene";

/**
 * 实体参考图（按场景隔离）。
 */
export interface EntityRefsheetPrompt {
    entity_name: string;
    scene_id: string;
    kind: "character" | "prop" | "set";
    humanoid: boolean;
    layout: RefsheetLayout;
    prompt: string;
    source_scene: string;
    importance: number;
    referenced_shot_count: number;
    referenced_scene_count: number;
    source_group?: string;
    origin?: string;
    previous_scene_refs?: string[];
    /**
     * 该实体应参考的制服三视图名（仅在有制服归属时填写）。
     * - 提升个体：source_group 路径 → 填 `${source_group}制服`
     * - 独立抽取但语义属于制服化群体的个体：identity.group_member_of 路径 → 填 `${group_member_of}制服`
     * - 群体合照（group_photo）：填该群体自身的制服名
     * - 无制服归属：undefined
     *
     * 下游渲染任务会据此把 `uniform:<uniform_name>` 写入 reference_images；
     * 总览（buildOverview）会据此展示「应参考制服：xxx」便于人类核对。
     */
    uniform_name?: string;
}

export interface SceneEnvironmentPrompt {
    scene_id: string;
    design_nl: string;
    refine_nl: string;
    prompt: string;
    review_history: Array<{
        round: number;
        verdict: "PASS" | "REVISE";
        feedback: string;
    }>;
    real_world_references: string[];
    importance: number;
    refsheet_entities: string[];
    inline_entities: Array<{ name: string; description: string }>;
    excluded_dynamic_props: string[];
    review_round: number;
    referenced_shot_count: number;
    referenced_scene_count: number;
}

export interface SceneShotPrompt {
    scene_id: string;
    shot_index: number;
    prompt: string;
    reference_images: Array<{
        entity_name: string;
        role: string;
    }>;
    shot_meta: {
        shot_type: string;
        camera_movement: string;
        duration_estimate: string;
    };
}

export interface RenderTaskDescriptor {
    id: string;
    type:
    | "entity_refsheet"
    | "scene_environment"
    | "uniform_turnaround"
    | "group_photo";
    prompt: string;
    importance: number;
    referenced_shot_count?: number;
    referenced_scene_count?: number;
    scene_id?: string;
    reference_images?: Array<{
        ref_id: string;
        entity_name: string;
        role: string;
    }>;
    asset_info?: {
        entity_name: string;
        kind: string;
        layout: RefsheetLayout;
        humanoid: boolean;
        base_description: string;
    };
    scene_info?: {
        scene_id: string;
        environment: string;
        lighting_summary: string;
        inline_entities: Array<{ name: string; description: string }>;
    };
    uniform_info?: {
        uniform_name: string;
        group_entity_name: string;
        wearer_gender: "male" | "female" | "androgynous";
    };
    group_info?: {
        group_entity_name: string;
        scene_id?: string;
    };
}