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
 *
 * 关键变化：
 * - 新增 scene_id 字段，每个场景一张独立的参考图
 * - 同一实体的不同场景可以有不同的 reference_image（换装/衰老/伤痕后）
 * - source_group 提升个体也带 scene_id，与所属场景对齐
 */
export interface EntityRefsheetPrompt {
    /** 实体规范名 */
    entity_name: string;
    /** 所属场景 id（场景隔离的标识） */
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
 * 渲染任务（按场景隔离）。
 */
export interface RenderTask {
    /** 任务 id：对于实体参考图 = `${sceneId}__${entityName}`；对于环境图 = sceneId；对于制服 = `uniform:${name}` */
    id: string;
    type: "entity_refsheet" | "scene_environment" | "uniform_turnaround" | "group_photo";
    prompt: string;
    importance: number;
    referenced_shot_count?: number;
    referenced_scene_count?: number;
    /** 所属场景 id（场景隔离） */
    scene_id?: string;
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

export interface RenderResult {
    id: string;
    file_path: string;
}