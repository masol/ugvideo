// nodes/generate-reference-images/prompts/refsheet-style.ts

/**
 * 为定妆照提示词生成提供风格/色调约束片段。
 * 每个配置值对应固定的提示词翻译约束。
 */

const STYLE_CONSTRAINTS: Record<string, string> = {
    cinematic: `【风格约束·提示词翻译】
- 提示词收尾段加入：cinematic lighting, shallow depth of field, film grain
- 色彩描述偏电影感：低饱和暗部、高光微暖
- 材质描述偏写实摄影：皮肤散射、布料纤维可见`,

    anime: `【风格约束·提示词翻译】
- 提示词收尾段加入：cel-shaded look, clean linework, vibrant colors
- 色彩描述偏高饱和、色块分明
- 材质描述偏平面质感：清晰描边、锐利阴影边界`,

    cg: `【风格约束·提示词翻译】
- 提示词收尾段加入：PBR rendering quality, subsurface scattering on skin, sharp specular highlights on metal
- 色彩描述偏精确：含高光色偏和阴影色偏
- 材质描述偏物理真实：金属反射率、布料褶皱走向`,

    live: `【风格约束·提示词翻译】
- 提示词收尾段加入：natural light photography, real skin texture with pores, authentic fabric fibers
- 色彩描述偏自然还原：不做风格化调色
- 材质描述偏触感真实：毛孔、纤维、磨损`,

    watercolor: `【风格约束·提示词翻译】
- 提示词收尾段加入：watercolor painting texture, soft bleeding edges, visible brushstrokes, paper grain
- 色彩描述偏淡雅：大面积留白、重色点缀
- 材质描述偏笔触：晕染边缘、水迹痕`,

    comic: `【风格约束·提示词翻译】
- 提示词收尾段加入：bold ink outlines, halftone dot shading, high contrast black and white with spot color
- 色彩描述偏高对比：亮部极亮、暗部纯黑
- 材质描述偏线条表现：网点阴影、粗黑描边`,

    pixel: `【风格约束·提示词翻译】
- 提示词收尾段加入：pixel art style, limited color palette, no anti-aliasing, crisp pixel edges
- 色彩描述偏限色板：单场景不超 16-32 色
- 材质描述偏像素化：抖动渐变、对齐网格`,

    noir: `【风格约束·提示词翻译】
- 提示词收尾段加入：film noir lighting, high contrast black and white, deep shadows, single hard light source
- 色彩描述偏黑白灰：仅极少量彩色点缀
- 材质描述偏光影质感：硬光投影、湿润反光`,
};

const COLOR_TONE_CONSTRAINTS: Record<string, string> = {
    warm_vibrant: `【色调约束·提示词翻译】
- 描述色彩时偏暖橙、高饱和：用"warm amber""golden""rich warm"等词
- 高光描述偏暖黄，阴影描述偏暖棕
- 收尾加入：warm vibrant color palette`,

    warm_muted: `【色调约束·提示词翻译】
- 描述色彩时偏胶片褪色感：用"muted warm""faded amber""dusty golden"等词
- 高光偏淡黄，阴影偏绿棕
- 收尾加入：vintage film color palette, muted warm tones`,

    neutral: `【色调约束·提示词翻译】
- 描述色彩时保持自然还原，不偏暖不偏冷
- 不加额外色调修饰词
- 收尾加入：natural color balance`,

    cool_crisp: `【色调约束·提示词翻译】
- 描述色彩时偏冷蓝、清透：用"cool blue""crisp white""icy"等词
- 高光偏冷白/淡蓝，阴影偏深蓝
- 收尾加入：cool crisp color palette, clean blue undertones`,

    cool_moody: `【色调约束·提示词翻译】
- 描述色彩时偏深冷暗调：用"deep cold blue""moody dark""desaturated"等词
- 整体偏暗，阴影保留细节但不明亮
- 收尾加入：moody desaturated cool tones, dark atmosphere`,
};

// ============================================================
// 风格锚定词（替代所有硬编码的 "photorealistic, real photography"）
// ============================================================

/**
 * 环境图锚定模板的风格词。
 * 包含 imageType（替代模板开头的 "cinematic environmental photograph"）
 * 和 anchor（替代模板中的 "photorealistic, real photography"）。
 */
const ENVIRONMENT_STYLE_ANCHORS: Record<string, { imageType: string; anchor: string }> = {
    cinematic: {
        imageType: "cinematic environmental photograph",
        anchor: "photorealistic, real photography, cinematic lighting, film grain",
    },
    anime: {
        imageType: "anime environment concept art",
        anchor: "anime background painting, cel-shaded rendering, clean linework, vibrant flat colors",
    },
    cg: {
        imageType: "CG rendered environment",
        anchor: "PBR materials, global illumination, ray-traced lighting, physically accurate rendering",
    },
    live: {
        imageType: "location scouting photograph",
        anchor: "photorealistic, real photography, natural light, authentic material textures",
    },
    watercolor: {
        imageType: "watercolor environment painting",
        anchor: "watercolor painting texture, soft bleeding edges, visible brushstrokes, paper grain",
    },
    comic: {
        imageType: "comic book environment panel",
        anchor: "bold ink outlines, halftone shading, high contrast, graphic novel aesthetic",
    },
    pixel: {
        imageType: "pixel art environment scene",
        anchor: "pixel art style, limited color palette, crisp pixel edges, no anti-aliasing, retro game aesthetic",
    },
    noir: {
        imageType: "film noir environment photograph",
        anchor: "film noir lighting, high contrast black and white, deep shadows, wet surface reflections",
    },
};

/**
 * 实体参考图（定妆照/制服/群体合照）的风格锚定词。
 * 替代模板中硬编码的 "photorealistic ... real human / real photography" 等。
 */
const REFSHEET_STYLE_ANCHORS: Record<string, {
    character_humanoid: string;
    character_non_humanoid: string;
    prop: string;
    uniform: string;
    group_photo: string;
}> = {
    cinematic: {
        character_humanoid: "full-frame DSLR photograph, ultra realistic skin texture with visible pores, real human, cinematic lighting, film grain",
        character_non_humanoid: "natural history specimen photograph, ultra realistic surface texture, cinematic lighting, film grain",
        prop: "professional product photograph, ultra realistic surface detail, cinematic lighting, film grain",
        uniform: "costume design reference, photorealistic fabric rendering, cinematic lighting, film grain",
        group_photo: "full-frame DSLR photograph, ultra realistic skin and fabric texture, real humans, cinematic lighting, film grain",
    },
    anime: {
        character_humanoid: "anime character illustration, cel-shaded rendering, clean linework, vibrant colors, consistent anime proportions",
        character_non_humanoid: "anime creature illustration, cel-shaded rendering, clean linework, vibrant colors",
        prop: "anime prop illustration, cel-shaded rendering, clean outlines, flat color fills",
        uniform: "anime costume design sheet, cel-shaded rendering, clean linework, flat color fills",
        group_photo: "anime group illustration, cel-shaded rendering, clean linework, vibrant colors, consistent style across all characters",
    },
    cg: {
        character_humanoid: "CG character render, PBR materials, subsurface scattering skin, sharp specular highlights, physically accurate",
        character_non_humanoid: "CG creature render, PBR materials, physically accurate surface shading, high polygon detail",
        prop: "CG product render, PBR materials, physically accurate surface, studio HDRI lighting",
        uniform: "CG costume render, PBR fabric simulation, physically accurate material response",
        group_photo: "CG group render, PBR materials, subsurface scattering skin, consistent character shading",
    },
    live: {
        character_humanoid: "full-frame DSLR photograph, ultra realistic skin texture with visible pores, real human, natural light photography",
        character_non_humanoid: "nature documentary photograph, ultra realistic surface texture, natural light",
        prop: "professional product photograph, ultra realistic surface detail, natural light photography",
        uniform: "costume reference photograph, authentic fabric texture, natural light",
        group_photo: "full-frame DSLR photograph, ultra realistic skin and fabric texture, real humans, natural light",
    },
    watercolor: {
        character_humanoid: "watercolor character portrait, soft bleeding edges, visible brushstrokes, paper grain, delicate ink outlines",
        character_non_humanoid: "watercolor creature illustration, soft washes, visible brushstrokes, paper grain texture",
        prop: "watercolor object study, soft washes, visible brushstrokes, paper grain",
        uniform: "watercolor costume design, soft washes, delicate ink outlines, paper grain",
        group_photo: "watercolor group illustration, soft washes, visible brushstrokes, paper grain, consistent style",
    },
    comic: {
        character_humanoid: "comic book character art, bold ink outlines, halftone dot shading, high contrast, spot color",
        character_non_humanoid: "comic book creature art, bold ink outlines, halftone shading, high contrast",
        prop: "comic book prop illustration, bold ink outlines, flat color fills, high contrast",
        uniform: "comic book costume design, bold ink outlines, flat color fills, halftone shading",
        group_photo: "comic book group panel, bold ink outlines, halftone shading, high contrast, consistent style",
    },
    pixel: {
        character_humanoid: "pixel art character sprite, limited color palette, crisp pixel edges, no anti-aliasing, retro game aesthetic",
        character_non_humanoid: "pixel art creature sprite, limited color palette, crisp pixel edges, no anti-aliasing",
        prop: "pixel art item sprite, limited color palette, crisp pixel edges, no anti-aliasing",
        uniform: "pixel art costume sprite sheet, limited color palette, crisp pixel edges, no anti-aliasing",
        group_photo: "pixel art group sprite sheet, limited color palette, crisp pixel edges, consistent pixel density",
    },
    noir: {
        character_humanoid: "film noir character portrait, high contrast black and white, deep shadows, single hard light source, wet reflections",
        character_non_humanoid: "film noir creature illustration, high contrast black and white, deep shadows, dramatic single light",
        prop: "film noir object study, high contrast black and white, deep shadows, dramatic lighting",
        uniform: "film noir costume reference, high contrast black and white, deep shadows",
        group_photo: "film noir group portrait, high contrast black and white, deep shadows, dramatic single light source",
    },
};

export interface RefsheetStyleConfig {
    style: string;
    color_tone: string;
}

/**
 * 根据全局配置生成定妆照提示词翻译的风格约束片段。
 */
export function buildRefsheetStyleSection(cfg: RefsheetStyleConfig): string {
    const blocks: string[] = [
        STYLE_CONSTRAINTS[cfg.style] ?? STYLE_CONSTRAINTS["cinematic"],
        COLOR_TONE_CONSTRAINTS[cfg.color_tone] ?? COLOR_TONE_CONSTRAINTS["neutral"],
    ];
    return blocks.join("\n\n");
}

/**
 * 获取环境图锚定模板中的风格词。
 */
export function getEnvironmentStyleAnchor(style: string): { imageType: string; anchor: string } {
    return ENVIRONMENT_STYLE_ANCHORS[style] ?? ENVIRONMENT_STYLE_ANCHORS["cinematic"];
}

export type RefsheetAnchorKind = "character_humanoid" | "character_non_humanoid" | "prop" | "uniform" | "group_photo";

/**
 * 获取实体参考图（定妆照/制服/群体合照）的风格锚定短语。
 * 替代模板中硬编码的 "photorealistic ... real human" 等。
 */
export function getRefsheetStyleAnchor(style: string, kind: RefsheetAnchorKind): string {
    const map = REFSHEET_STYLE_ANCHORS[style] ?? REFSHEET_STYLE_ANCHORS["cinematic"];
    return map[kind];
}