// nodes/design-shots/types.ts

/** 全局视觉准则（从配置项读取） */
export interface GlobalStyle {
    aspect_ratio: string;
    pacing: "normal" | "slow" | "fast";
    style: string;
    audience: "g" | "pg" | "pg13" | "r" | "nc17";
    color_tone: string;
    camera_movement: string;
}

/** 素材全局约束条目 */
export interface AssetConstraint {
    entity_name: string;
    /** 累积的视觉描述 */
    visual_description: string;
    /** 来源场景 */
    source_scene: string;
}

/**
 * 单实体素材描述（按场景独立落盘）。
 *
 * 注意：base_description 必须严格只包含跨场景不变的部分（族裔/五官/物种/默认服装）。
 * 本场景特有的换装/受伤/光影效果放在 scene_delta + lighting_effect。
 * 这是为了下游"按场景生成参考图"时，每个场景的服装外观可以独立变化。
 */
export interface EntityAsset {
    /** 实体规范名 */
    entity_name: string;
    /** 所属场景 id（场景隔离） */
    scene_id: string;
    /** 实体类别 */
    kind: string;
    /** 重要性 */
    importance: "primary" | "secondary";
    /** 基础视觉描述（族裔/五官/体型/物种/默认服装基础形态） */
    base_description: string;
    /** 本场景叠加描述（换装/受伤/姿态/配饰等本场景变化） */
    scene_delta: string;
    /** 本场景光影效果（基于场景光照） */
    lighting_effect: string;
    /** 衰老/伤痕进度（与上一场景对比的时间跳跃标记，由 design-shots 填充） */
    age_progression?: "none" | "subtle" | "noticeable";
}

/** 场景光照设计 */
export interface SceneLighting {
    key_light_direction: string;
    key_light_color: string;
    fill_light: string;
    ambient: string;
    summary: string;
}