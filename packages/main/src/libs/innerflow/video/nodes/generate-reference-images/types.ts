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

/**
 * 渲染任务描述（供下游 render-images 节点消费）。
 *
 * 任务分两大尺寸类别：
 * - 参考图类（entity_refsheet / scene_environment / uniform_turnaround / group_photo）：
 *   跨镜头一致性锚点，固定 16:9 2K。
 * - 交付帧类（scene_shot）：最终成片首尾帧，用配置横纵比。
 */
export interface RenderTaskDescriptor {
    id: string;
    type:
    | "entity_refsheet"
    | "scene_environment"
    | "uniform_turnaround"
    | "group_photo"
    | "scene_shot";
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
    /** 交付帧（scene_shot）专属：镜头元信息 */
    shot_info?: {
        scene_id: string;
        shot_index: number;
        shot_type: string;
        camera_movement: string;
        duration_estimate: string;
    };
}