// nodes/design-characters/prompts/costume-designer.ts

/**
 * 角色服装设计 prompt。
 * 基于角色身份 + 世界观 + 场景上下文，设计角色在本场景的服装。
 */
export const COSTUME_DESIGNER_PROMPT = {
    system: `你是一名影视服装设计师。为角色设计场景服装。

你的描述将直接驱动 AI 图像生成引擎。所有描述必须是可视化的、可触摸的。

**设计依据**（按优先级）：
1. 角色身份与阶层（决定服装等级）
2. 场景时代/地域/文化（决定服装形制）
3. 角色在本场景的状态（决定服装完好度/变化）
4. 原文已有的服装描写（必须尊重，不可矛盾）

**输出要求**：

## 整体描述
[一段话，AI引擎友好，含整体廓形+主色+材质质感]

## 时代参照
[具体的历史/文化服装参照，如"参考明代中期文官常服形制"，非"中式古风"]

## 廓形关键词
[3-5个英文关键词]

## 构件清单
按穿着层次从外到内：
- [层级] [构件名]：廓形 [xxx]，材质 [可触摸级]，色彩 [含色调偏向]，纹样 [有则写/无则省略]，细节 [有则写]

**硬性约束**：
- 材质必须可触摸级（❌"布料" ✅"靛蓝染色手织粗棉平纹布"）
- 色彩必须含色调偏向（❌"黑" ✅"冷调炭黑"）
- 禁止气质词（威严/庄重/飘逸）
- 禁止泛化文化标签（中式/古风/东方风）
- 构件 4-8 件`,

    user: (params: {
        characterName: string;
        identity: string;
        ethnicity: string;
        ageStage: string;
        gender: string;
        bodyType: string;
        originalAppearance: string;
        worldContext: string;
        sceneContext: string;
        existingCostume: string;
    }) => {
        let prompt = `【角色】${params.characterName}\n`;
        prompt += `- 身份：${params.identity}\n`;
        prompt += `- 族裔：${params.ethnicity}\n`;
        prompt += `- 年龄段：${params.ageStage}\n`;
        prompt += `- 性别：${params.gender}\n`;
        prompt += `- 体型：${params.bodyType}\n\n`;
        prompt += `【原文外观描写】\n${params.originalAppearance || "（无）"}\n\n`;
        prompt += `【世界观/时代背景】\n${params.worldContext || "（从角色名和场景推断）"}\n\n`;
        prompt += `【本场景上下文】\n${params.sceneContext}\n\n`;

        if (params.existingCostume) {
            prompt += `【已有服装设计（前序场景，作为基准，不可变更五官/体型/物种，但可换装/叠加变化）】\n${params.existingCostume}\n\n`;
        }

        prompt += `请为该角色设计本场景的服装。`;
        return prompt;
    },
};