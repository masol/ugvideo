// nodes/generate-reference-images/prompts/entity-refsheet.ts

/**
 * 实体定妆照提示词生成的 System Prompt。
 *
 * 本 prompt 不产出新设计，只做翻译：把上游的结构化描述转为 AI 引擎友好的自然语言。
 * 风格/色调约束由外部注入（styleSection），不硬编码。
 */
export const ENTITY_REFSHEET_PROMPT = {
    system: (styleSection: string, translationSkill: string) =>
        `你是一名提示词翻译工程师，专精把结构化视觉描述转为 AI 图像生成引擎可消费的自然语言提示词。

你的唯一职责是翻译，不做任何新设计。上游已完成全部外观设计。

${styleSection}

---

以下是针对本实体类型的提示词翻译步骤（严格按步骤执行）：

${translationSkill}

---

**AI 引擎友好性（最高优先级铁律）**：

你的提示词将直接驱动 AI 图像生成引擎。必须用引擎训练数据中常见的词汇：

1. **禁止的词汇类型**：
   - 角度数值（15°、45°、110°）
   - 厘米/毫米级尺寸
   - 百分比（18%、65%）
   - 解剖学术语（胸锁乳突肌、颧骨高点、股四头肌）
   - 色值（#C8A88A、RGB）

2. **用什么替代**：
   - ❌ "颧骨高点定位於1.2厘米处" → ✅ "高颧骨"
   - ❌ "躯干前倾15°" → ✅ "身体微微前倾"
   - ❌ "瞳孔扩大18%" → ✅ "瞳孔放大"
   - ❌ "肩宽为头宽3倍" → ✅ "宽肩"

3. **动作用最简单的动词**：
   - ❌ "单膝压地+躯干前倾的受压姿态" → ✅ "单膝跪地"
   - ❌ "右前臂尺侧轻贴桌面" → ✅ "右手撑桌"

4. **手部极简化**：
   - 不描述手指数量、关节角度
   - 只写：握拳/摊开/持物/垂放/背后

5. **描述重心**：
   - 70%：整体轮廓 + 主色 + 材质质感
   - 20%：服装/表面纹理具体构件
   - 10%：姿态动作（用最简动词）

6. **颜色必须具体含色调**：
   - ❌ "黑" → ✅ "冷调炭黑"
   - ❌ "白" → ✅ "泛黄生白"

7. **材质可触摸级**：
   - ❌ "布料" → ✅ "靛蓝染色手织粗棉平纹布"
   - ❌ "皮革" → ✅ "油鞣深褐色牛皮，表面磨损泛光"

**输出格式**（纯自然语言，不输出 JSON）：

按以下顺序组装提示词短语（逗号分隔）：

[1] 图像类型与构图锚定（16:9 宽屏 + 布局指令）
[2] 实体基础特征（用 AI 友好的常见词）
[3] 本场景变化（动作用最简动词）
[4] 光影效果（自然语言，不写光比数值）
[5] 参考图依赖（若有）：@{依赖实体名}
[6] 真实照片级收尾（肯定句）`,

    user: (params: {
        entityName: string;
        kind: string;
        humanoid: boolean;
        layout: "four_column" | "three_column" | "magazine_grid";
        baseDescription: string;
        sceneDelta: string;
        lightingEffect: string;
    }) => {
        const layoutInstruction = getLayoutInstruction(params.layout, params.humanoid, params.kind);

        let prompt = `【实体信息】\n`;
        prompt += `名称：${params.entityName}\n`;
        prompt += `类别：${params.kind}\n`;
        prompt += `是否类人：${params.humanoid ? "是" : "否"}\n`;
        prompt += `布局：${layoutInstruction.label}\n\n`;

        prompt += `【[1] 锚定段模板（直接使用，不要修改核心结构）】\n${layoutInstruction.template}\n\n`;

        prompt += `【基础描述（跨场景不变特征，需AI引擎友好化翻译）】\n${params.baseDescription}\n\n`;

        if (params.sceneDelta && params.sceneDelta !== "无") {
            prompt += `【本场景变化（动作用最简动词）】\n${params.sceneDelta}\n\n`;
        }

        prompt += `【光影效果（自然语言，不写数值）】\n${params.lightingEffect}\n\n`;

        prompt += `请按 [1]-[6] 顺序组装提示词。[1] 使用上方锚定段模板。记住：用 AI 引擎能理解的常见词，禁止学术精度，动作用最简动词。`;
        return prompt;
    },
};

interface LayoutInstruction {
    label: string;
    template: string;
}

function getLayoutInstruction(
    layout: "four_column" | "three_column" | "magazine_grid",
    humanoid: boolean,
    kind: string,
): LayoutInstruction {
    if (layout === "four_column") {
        return {
            label: "16:9 四列布局（正面/左45°/右45°/背面）",
            template: `cinematic photorealistic character reference sheet, standard 16:9 widescreen composition, four-column turnaround — front view, left three-quarter view, right three-quarter view, back view, same person consistently across all four views, identical face and proportions, plain white background, neutral standing pose, arms at sides, soft even studio lighting, natural skin tones, full-frame DSLR photograph, ultra realistic skin texture, real human`,
        };
    }

    if (layout === "magazine_grid") {
        return {
            label: "16:9 杂志式网格（上方侧面大图横向舒展 + 下方正背小图）",
            template: `photorealistic creature reference sheet, standard 16:9 widescreen composition, magazine-style grid layout — upper panel: one large wide lateral side-view spanning the full width, complete body fully extended horizontally from head to tail without coiling or compression, entire body length visible; lower row: two equal-sized smaller panels side by side — left panel front view, right panel back view, same individual consistently across all panels, identical form and proportions and surface texture, plain white background, soft even diffused lighting revealing full surface detail, natural history specimen photograph, ultra realistic surface texture, real photographic specimen`,
        };
    }

    // three_column
    const entityType = kind === "character" ? "creature" : "object";
    return {
        label: "16:9 三列布局（正面/侧面/背面）",
        template: `photorealistic ${entityType} reference sheet, standard 16:9 widescreen composition, three-column turnaround — front view, side view, back view, same ${entityType} consistently across all three views, identical form and surface, plain white background, neutral position, soft even studio lighting revealing material texture, professional photograph, ultra realistic surface detail`,
    };
}