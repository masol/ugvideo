// nodes/generate-reference-images/types.ts

export type RefsheetLayout =
    | "four_column"
    | "three_column"
    | "magazine_grid"
    | "uniform_turnaround"
    | "group_photo";

export type EntitySpatialRole = "fixed_set" | "dynamic_prop" | "off_scene";

export interface EntityRefsheetPrompt {
    entity_name: string;
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

/**
 * 场景环境基底图提示词。
 *
 * 设计过程：
 * 1. 初次设计（design）—— 空间结构 + 固定陈设 + 光照
 * 2. 细化（refine）—— 沿场景氛围补充痕迹、细节、材质老化、岁月感
 * 3. 评审（review）—— 检查设计是否能承载后续剧情（门/窗/通道/必要的视觉锚点）
 * 4. 评审通过后固化为最终 prompt
 */
export interface SceneEnvironmentPrompt {
    scene_id: string;
    /** 初次设计 NL（评审未通过时保留作为反馈输入） */
    design_nl: string;
    /** 细化 NL（评审未通过时保留） */
    refine_nl: string;
    /** 最终导出的提示词（评审通过或达到最大轮次后固化） */
    prompt: string;
    /** 评审历史（每轮 verdict + feedback） */
    review_history: Array<{
        round: number;
        verdict: "PASS" | "REVISE";
        feedback: string;
    }>;
    real_world_references: string[];
    importance: number;
    /** 真正固定在场、有独立参考图的陈设/动态道具 */
    refsheet_entities: string[];
    /** 内联描述的陈设（无独立参考图但固定在场景中的） */
    inline_entities: Array<{ name: string; description: string }>;
    /** 动态道具（origin="character:..."），不进环境图，仅供镜头提示词消费 */
    excluded_dynamic_props: string[];
    /** 当前评审轮次（用于持久化进度） */
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

export interface RenderTask {
    id: string;
    type: "entity_refsheet" | "scene_environment" | "uniform_turnaround" | "group_photo";
    prompt: string;
    importance: number;
    referenced_shot_count?: number;
    referenced_scene_count?: number;
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
    };
}

export interface RenderResult {
    id: string;
    file_path: string;
}