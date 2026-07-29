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

/** 单实体素材描述（独立落盘） */
export interface EntityAsset {
    /** 实体规范名 */
    entity_name: string;
    /** 实体类别 */
    kind: string;
    /** 重要性 */
    importance: "primary" | "secondary";
    /** 基础视觉描述（跨场景不变部分：五官/体型/物种） */
    base_description: string;
    /** 本场景叠加描述（换装/受伤/姿态/配饰等本场景变化） */
    scene_delta: string;
    /** 本场景光影效果（基于场景光照） */
    lighting_effect: string;
}

/** 场景光照设计 */
export interface SceneLighting {
    /** 主光源方向（如"左上方45°""正面平光""逆光"） */
    key_light_direction: string;
    /** 主光色温（如"暖黄 3200K""冷白 6500K"） */
    key_light_color: string;
    /** 补光描述（如"右侧弱补光，填充阴影"或"无补光"） */
    fill_light: string;
    /** 环境光/氛围（如"雾气散射""尘埃粒子""无"） */
    ambient: string;
    /** 整体光照效果一句话概括 */
    summary: string;
}