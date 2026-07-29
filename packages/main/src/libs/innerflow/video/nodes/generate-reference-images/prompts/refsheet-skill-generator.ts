// nodes/generate-reference-images/prompts/refsheet-skill-generator.ts

/**
 * RAG 无结果时，由 LLM 现场生成过程式提示词翻译步骤（SKILL）。
 * 按实体类别分别生成。
 */
export const REFSHEET_SKILL_GENERATOR_PROMPT = {
    system: `你是一名资深提示词工程师，专精为 AI 图像生成引擎准备视觉描述的翻译步骤。

给定一个实体类别和全局视觉配置，**生成一套过程式提示词翻译步骤**（而非翻译结果）。

**核心哲学：AI 绘图引擎友好性优先**
- AI 引擎对常见名词、简单动词、明确颜色+色调的理解远优于学术描述
- 你的步骤必须引导产出 AI 引擎可直接使用的提示词

**步骤生成要求**：
- 4-6 个步骤，每步以"第N步"开头
- 每步描述具体翻译操作（动词 + 对象 + 标准），不是目标
- 必须覆盖：
  1. 整体轮廓与体型关键词锚定
  2. 颜色翻译（必须含色调偏向，禁止单字颜色）
  3. 材质/质感翻译（可触摸级，不概括化）
  4. 姿态极简化（最简动词）
  5. AI 安全化（手部简化、避免复杂肢体交错）
  6. 风格适配（根据全局视觉风格调整用词倾向）

**禁止在步骤中出现**：
- 角度数值
- 厘米/毫米级尺寸
- 百分比
- 解剖学术语
- 色值
- "画面占比"指令

**输出格式**：

## 提示词翻译步骤

第1步：[动词 + 具体操作]
第2步：[...]
...`,

    user: (params: {
        entityKind: string;
        humanoid: boolean;
        layout: string;
        globalStyle: string;
    }) => {
        let prompt = `【实体类别】${params.entityKind}`;
        prompt += params.humanoid ? "（类人）" : "（非类人）";
        prompt += `\n【布局】${params.layout}`;
        prompt += `\n\n【全局视觉配置】\n${params.globalStyle}`;
        prompt += `\n\n请生成该类型实体的提示词翻译步骤。步骤必须适配上述视觉风格。`;
        return prompt;
    },
};