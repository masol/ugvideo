// nodes/generate-reference-images/prompts/entity-refsheet.ts

/**
 * 全局实体参考图提示词。
 *
 * 布局类型：
 * - four_column：类人角色（左侧大头特写 + 右侧全身三视图）
 * - three_column：非类人角色 / 道具 / 陈设
 * - magazine_grid：长形生物（龙/蛇/虫）
 * - group_photo：群体合照（自然站位，不分列，白背景）
 */
export const ENTITY_REFSHEET_PROMPT = {
    system: (styleSection: string, translationSkill: string) =>
        `你是一名参考图提示词工程师。把上游"实体基础外观描述"转为 AI 图像生成引擎的参考图提示词。

**你的输出仅描述实体在纯白背景下的外观，供跨场景一致性参考。**

${styleSection}

---

以下是针对本实体类型的提示词翻译步骤：

${translationSkill}

---

**铁律（任何一条违反即为失败）**：

1. **纯白背景**：提示词必须包含 "plain white background"，绝不描述任何环境、空间、场景
2. **无场景光照**：只用 "soft even studio lighting"，绝不写任何方向性光影（斜射/逆光/侧光/顶光/体积光）
3. **无任何动作姿态**：全身区域用 "neutral standing pose, arms at sides"（类人）或 "neutral position"（非类人），大头区域表情中性视线平视；群体合照用自然站立排列；绝不写场景动作
4. **无空间定位**：绝不写"左侧"/"桌面"/"墙上"/"中间"等场景位置词
5. **绝不输出 meta 声明**：不要写"serves as reference for..."/"visual reference for..."等自引用声明
6. **绝不输出编号**：不要 [1] [2] [3] 段号
7. **绝不输出场景变化**：本场景的脏污/伤痕/表情变化不在你的输出范围内
8. **族裔必须显式**：类人角色族裔写在提示词前部
9. **材质可触摸级**：❌ "布料" → ✅ "靛蓝染色手织粗棉平纹布"
10. **颜色含色调**：❌ "黑" → ✅ "冷调炭黑"

**输出**：直接输出提示词短语（逗号分隔），不编号、不分段、不解释、不写任何额外声明。`,

    user: (params: {
        entityName: string;
        kind: string;
        humanoid: boolean;
        ethnicity: string;
        layout: "four_column" | "three_column" | "magazine_grid" | "group_photo";
        baseDescription: string;
        styleAnchor: string;
        layoutTemplate: string;
        groupCount?: string;
        uniformReference?: string;
    }) => {
        let prompt = `【实体】${params.entityName}（${params.kind}）\n`;
        prompt += `【族裔】${params.ethnicity}\n`;
        prompt += `【构图模板（直接使用，不要修改）】\n${params.layoutTemplate}\n\n`;
        prompt += `【跨场景不变的基础外观描述】\n${params.baseDescription}\n\n`;

        if (params.uniformReference) {
            prompt += `【所属群体的制服设计（本个体服装必须与此制服一致）】\n${params.uniformReference}\n\n`;
        }

        prompt += `请直接输出提示词。记住：纯白背景、无场景光照（仅 studio lighting）、无任何动作（仅中性站姿；大头区域表情中性视线平视；群体合照自然站立排列）、无空间定位、无 meta 声明、无编号、无场景变化。`;
        return prompt;
    },
};

/**
 * 根据布局类型 + 风格锚定词生成构图模板文本。
 * 模板中的风格词不再硬编码，由 styleAnchor 参数注入。
 */
export function buildLayoutTemplate(
    layout: "four_column" | "three_column" | "magazine_grid" | "group_photo",
    humanoid: boolean,
    kind: string,
    styleAnchor: string,
    groupCount?: string,
): string {
    if (layout === "four_column") {
        return `character reference sheet, standard 16:9 widescreen composition, four-panel layout — left panel: large close-up headshot, face fills 70 percent of the panel, eyes looking straight ahead, neutral expression, hair and headwear fully visible from front, top of shoulders included at bottom edge; right three panels: full-body turnaround — front view, left three-quarter view, back view, same person consistently across all four panels, identical face proportions and skin tone and hair and clothing, plain white background, neutral standing pose, arms at sides, soft even studio lighting, natural skin tones, ${styleAnchor}`;
    }

    if (layout === "group_photo") {
        const countHint = groupCount && groupCount !== "群体"
            ? `exactly ${groupCount} individuals`
            : "a small consistent group of individuals";
        return `group reference image, standard 16:9 widescreen composition, ${countHint} standing together in a natural loose arrangement facing the camera, full body visible for the front row, consistent shared visual style across all members — same clothing type and material and color palette, same overall body type range and hair style range, plain white background, neutral standing poses, arms at sides, soft even studio lighting, natural skin tones, ${styleAnchor}`;
    }

    if (layout === "magazine_grid") {
        return `creature reference sheet, standard 16:9 widescreen composition, magazine-style grid layout — upper panel: one large wide lateral side-view spanning the full width, complete body fully extended horizontally from head to tail without coiling or compression, entire body length visible; lower row: two equal-sized smaller panels side by side — left panel front view, right panel back view, same individual consistently across all panels, identical form and proportions and surface texture, plain white background, soft even diffused lighting revealing full surface detail, ${styleAnchor}`;
    }

    const entityType = kind === "character" ? "creature" : "object";
    return `${entityType} reference sheet, standard 16:9 widescreen composition, three-column turnaround — front view, side view, back view, same ${entityType} consistently across all three views, identical form and surface, plain white background, neutral position, soft even studio lighting revealing material texture, ${styleAnchor}`;
}