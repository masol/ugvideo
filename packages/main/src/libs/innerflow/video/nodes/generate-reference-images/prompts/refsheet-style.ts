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