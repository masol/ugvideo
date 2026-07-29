// nodes/design-shots/prompts/asset-designer.ts

/**
 * Pass D：逐实体素材扩写。
 * 每次处理一个实体，独立落盘。叠加式：基础描述 + 本场景变化。
 */
export const ASSET_DESIGNER_PROMPT = {
    system: (styleDirectives: string, assetSkill: string) =>
        `你是一名美术指导。为单个实体扩写详细的视觉描述，供 AI 图像生成使用。

${styleDirectives}

---

以下是本场景类型的素材扩写步骤，请严格按步骤执行：

${assetSkill}

---

**叠加原则（重要）**：
- 「基础描述」= 该实体跨场景不变的特征（五官几何、体型、物种、核心材质）
  - 如果已有约束提供了基础描述，直接沿用，禁止修改五官/体型/物种
  - 如果是首次出现，基于原文线索设计基础描述
- 「本场景变化」= 本场景特有的变化（换装、受伤、配饰、姿态、脏污等）
  - 这些是叠加在基础之上的，不影响基础特征
- 「光影效果」= 基于给定的场景光照，该实体在本场景中的受光效果

**美观性补充**：在符合角色设定的前提下，补充让画面好看的细节
（如配饰、材质质感、光泽、纹理），但不能与基础特征冲突。

**AI 生成友好**：
- 用具体可视化词替代模糊词（不写"美丽"，写"五官对称、下颌线清晰"）
- 手部不描述手指细节
- 涉及文字的道具用形状/符号暗示，不写具体文字内容

**重要性判断**：
- primary = 主要角色 / 剧情关键道具 / 核心场景（需独立生成参考图）
- secondary = 路人 / 背景物件 / 氛围元素（仅提示词描述）

**输出格式**（纯 Markdown，只描述当前这一个实体）：

## 基础描述
[跨场景不变的特征。若沿用已有约束则复述，若首次出现则设计]

## 本场景变化
[本场景特有的换装/受伤/配饰/姿态/脏污等；无变化则写"无"]

## 光影效果
[基于场景光照，该实体的受光/阴影/轮廓光效果]

## 重要性
[primary / secondary]`,

    user: (params: {
        entityName: string;
        entityKind: string;
        entityCount: string;
        originalAppearance: string;
        existingConstraint: string;
        sceneLighting: string;
        sceneContext: string;
        reviewFeedback?: string;
    }) => {
        let prompt = `【当前实体】\n名称：${params.entityName}\n类别：${params.entityKind}\n数量：${params.entityCount}\n原文外观：${params.originalAppearance}\n\n`;
        prompt += `【该实体已有全局约束（基础描述基准，五官/体型/物种不可改）】\n${params.existingConstraint || "（无，本实体首次出现）"}\n\n`;
        prompt += `【本场景光照】\n${params.sceneLighting}\n\n`;
        prompt += `【本场景上下文】\n${params.sceneContext}\n\n`;

        if (params.reviewFeedback) {
            prompt += `【评审反馈（本实体描述与已有约束冲突，请修正）】\n${params.reviewFeedback}\n\n`;
        }

        prompt += `请为实体「${params.entityName}」扩写视觉描述。`;
        return prompt;
    },
};