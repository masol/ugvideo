// nodes/generate-reference-images/types.ts

/** 实体定妆照布局类型 */
export type RefsheetLayout =
    | "four_column"
    | "three_column"
    | "magazine_grid";

/** 实体定妆照提示词 */
export interface EntityRefsheetPrompt {
    entity_name: string;
    kind: "character" | "prop" | "set";
    humanoid: boolean;
    layout: RefsheetLayout;
    prompt: string;
    dependencies: string[];
    source_scene: string;
}

/** 场景环境图提示词 */
export interface SceneEnvironmentPrompt {
    scene_id: string;
    prompt: string;
    real_world_references: string[];
    dependencies: string[];
}

/** 渲染任务 */
export interface RenderTask {
    id: string;
    type: "entity_refsheet" | "scene_environment";
    prompt: string;
    dependencies: string[];
    asset_info?: {
        entity_name: string;
        kind: string;
        layout: RefsheetLayout;
        humanoid: boolean;
        base_description: string;
        scene_delta: string;
        lighting_effect: string;
    };
    scene_info?: {
        scene_id: string;
        environment: string;
        lighting_summary: string;
    };
}

/** 渲染结果 */
export interface RenderResult {
    id: string;
    /** 生成图片的文件路径；空字符串 = 渲染失败 */
    file_path: string;
}