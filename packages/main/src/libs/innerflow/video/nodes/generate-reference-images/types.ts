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

/**
 * 场景镜头「视频」提示词（全能参考出视频的输入）。
 *
 * 重要：这是**视频**镜头描述，不是图像渲染任务。本管线不为 shot 渲染静图。
 * 下游视频节点读取本结构 + reference_images 指向的已渲染参考图，用全能参考生成视频。
 *
 * - prompt：视频镜头的自然语言导演指令（保留运动动词/运镜轨迹/动作时序）。
 * - reference_images[].entity_name：实际存放 ref_id（env:X / sceneId__name / uniform:X），
 *   可直接映射到已渲染参考图的 file_path（RenderStorage.getRenderResult(ref_id)）。
 * - shot_meta：景别/运镜/时长，供下游视频节点排片与时长控制。
 */
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
 * 全能参考工作流：渲染任务只含「跨镜头一致性参考图」，统一 16:9 2K。
 * 镜头（shot）不进渲染任务——它产出的是视频提示词（见 SceneShotPrompt），
 * 由下游视频节点消费，不渲染静图。
 */
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