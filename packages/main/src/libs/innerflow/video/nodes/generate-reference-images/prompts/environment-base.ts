// nodes/generate-reference-images/prompts/environment-base.ts

/**
 * 场景环境基底图提示词。
 *
 * 源头设计：
 * - 输入字段**不含**任何人物/角色描述的字段位
 * - system 明确禁止把人物活动/角色动作纳入环境图
 * - 所有 set/prop 描述**都进 prompt**（无论是否有独立参考图）
 */
export const ENVIRONMENT_BASE_PROMPT = {
    system: (styleSection: string) =>
        `你是一名环境摄影提示词工程师。为场景生成无人物的环境基底图提示词。

${styleSection}

---

**铁律**：

1. **绝对无人物**：提示词内容层面不得出现任何人物/角色/生物的描述。
   - 不要写"无人"（负面词），而是从内容上确保不提及人物
   - 不要从原文提取人物活动、角色动作、对话内容
   - 角色面部的五官、服装的穿戴状态、表情姿态——这些都不属于环境图
2. **所有陈设/道具必须出现**：本场景中的每个 set/prop 都在输入中列出，每个都必须在提示词中有视觉描述
3. **现实案例参照**：从空间环境推断 1-2 个现实世界地点/建筑作为视觉锚点
4. **光照完整**：包含主光/补光/环境氛围/整体效果四层
5. **AI 引擎友好**：用建筑摄影术语，不写学术精度数值
6. **不开头写 no humans/empty scene 等负面词**——而是从内容上排除人物

**输出**：直接输出提示词短语（逗号分隔），不编号不分段。开头必须是构图锚定模板。`,

    user: (params: {
        sceneId: string;
        environment: string;
        setEntities: Array<{ name: string; appearance: string }>;
        propEntities: Array<{ name: string; appearance: string }>;
        lighting: string;
        sceneText: string;
    }) => {
        let prompt = `【场景 ${params.sceneId}】\n\n`;

        prompt += `【空间环境（只描述空间结构、陈设布局、光照氛围，不提取任何人物活动）】\n${params.environment}\n\n`;

        if (params.setEntities.length > 0) {
            prompt += `【固定陈设（每个都必须出现在提示词中，给出位置+材质+色彩）】\n`;
            for (const e of params.setEntities) {
                prompt += `- ${e.name}：${e.appearance || "无原文描写，根据场景合理补充视觉细节"}\n`;
            }
            prompt += `\n`;
        }

        if (params.propEntities.length > 0) {
            prompt += `【道具（每个都必须出现在提示词中，给出位置+材质+色彩+状态）】\n`;
            for (const e of params.propEntities) {
                prompt += `- ${e.name}：${e.appearance || "无原文描写，根据场景合理补充视觉细节"}\n`;
            }
            prompt += `\n`;
        }

        prompt += `【光照方案】\n${params.lighting}\n\n`;

        prompt += `【场景原文（仅用于推断空间类型和现实案例参照，不从中提取人物描述）】\n${params.sceneText.slice(0, 500)}\n\n`;

        prompt += `请生成环境基底图提示词。开头使用以下构图模板：\n`;
        prompt += `"cinematic environmental photograph, standard 16:9 widescreen composition, wide establishing shot, architectural photography, location scouting reference, photorealistic, real photography"\n\n`;
        prompt += `确保每个 set/prop 都有具体视觉描述（位置+材质+色彩），不可遗漏。`;

        return prompt;
    },
};