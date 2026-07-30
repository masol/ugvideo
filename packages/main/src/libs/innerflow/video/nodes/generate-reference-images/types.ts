// nodes/generate-reference-images/types.ts

export type RefsheetLayout =
    | "four_column"
    | "three_column"
    | "magazine_grid"
    | "uniform_turnaround";

/** 全局参考图提示词（纯白背景定妆照，无场景光照/无场景变化） */
export interface EntityRefsheetPrompt {
    entity_name: string;
    kind: "character" | "prop" | "set";
    humanoid: boolean;
    layout: RefsheetLayout;
    /** 提示词正文：纯白背景 + 实体跨场景不变外观 */
    prompt: string;
    source_scene: string;
    importance: number;
}

/** 场景环境基底图提示词（无人物，含所有 set/prop 描述） */
export interface SceneEnvironmentPrompt {
    scene_id: string;
    /** 提示词正文：环境空间 + 所有 set/prop 视觉描述 */
    prompt: string;
    real_world_references: string[];
    importance: number;
    /** 本场景中有独立参考图的 set/prop 实体名（渲染时上传参考图） */
    refsheet_entities: string[];
    /** 本场景中无独立参考图的实体名 + 描述（在场景提示词中以文字描述它们） */
    inline_entities: Array<{ name: string; description: string }>;
}

/** 场景镜头提示词（按场景按镜头） */
export interface SceneShotPrompt {
    scene_id: string;
    shot_index: number;
    /** 最终合成提示词 */
    prompt: string;
    /** 本镜头引用的参考图（渲染时需上传） */
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

/** 渲染任务（参考图/环境图） */
export interface RenderTask {
    id: string;
    type: "entity_refsheet" | "scene_environment" | "uniform_turnaround";
    prompt: string;
    importance: number;
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
}

export interface RenderResult {
    id: string;
    file_path: string;
}