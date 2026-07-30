// nodes/generate-reference-images/prompts/scene-shot.ts

/**
 * 场景镜头提示词生成。
 *
 * 这是**按场景按镜头**生成的最终渲染指令，源头就是场景粒度。
 * 风格对齐 Vercel AI SDK 多图参考（I2I）的自然语言指令。
 */
export const SCENE_SHOT_PROMPT = {
    system: (styleSection: string) =>
        `你是一名镜头合成提示词工程师。把分镜设计 + 参考图 + 场景光照，组合为 AI 图像生成引擎的最终渲染指令。

${styleSection}

---

**输出风格（对齐多图参考的 I2I 指令）**：

你的输出是一段自然语言指令，告诉引擎"综合上传的参考图，生成这一镜的画面"。结构如下：

第一部分：参考图使用说明。格式：
"参考图使用说明：
1. [实体名] 的参考图：[如何使用，如'严格保持脸部特征和五官比例'/'参考服装款式'/'作为道具，保持材质和细节不变'/'作为环境基底，保持空间布局']
2. ..."

第二部分：最终画面描述。一段连贯的自然语言，包含：
- 景别与构图（来自分镜）
- 每个实体在画面中的位置、动作（用最简动词）、表情
- 本镜头的光影效果（基于场景光照）
- 实体之间的空间关系
- 结尾：画面质感收尾（照片级/风格锚定）

**铁律**：
1. 动作用最简动词：单膝跪地 / 右手撑桌 / 皱眉。禁止角度数值、解剖学术语
2. 只引用提供的参考图和实体，不臆造新实体
3. 画面描述要具体可视，但不重复参考图已锁定的外观细节（由参考图保证）
4. 必须自然衔接，像给摄影师的一句话导演指令
5. 不出现 @{} 占位符、不出现 meta 声明、不输出编号前缀`,

    user: (params: {
        sceneId: string;
        shotIndex: number;
        shotDescription: string;
        referenceImages: Array<{ entity_name: string; role: string }>;
        lightingText: string;
        inlineEntities: Array<{ name: string; description: string }>;
    }) => {
        let prompt = `【场景 ${params.sceneId} · 镜头 ${params.shotIndex}】\n\n`;

        prompt += `【本镜分镜设计】\n${params.shotDescription}\n\n`;

        if (params.referenceImages.length > 0) {
            prompt += `【可用参考图（按顺序，渲染时会依次上传）】\n`;
            params.referenceImages.forEach((ref, i) => {
                prompt += `${i + 1}. ${ref.entity_name}（用途：${ref.role}）\n`;
            });
            prompt += `\n`;
        }

        if (params.inlineEntities.length > 0) {
            prompt += `【无独立参考图、需在画面中描述的实体（无参考图保证一致性，必须显式描述外观）】\n`;
            for (const e of params.inlineEntities) {
                prompt += `- ${e.name}：${e.description}\n`;
            }
            prompt += `\n`;
        }

        prompt += `【本镜光影】\n${params.lightingText}\n\n`;

        prompt += `请输出本镜的最终渲染指令：先写参考图使用说明，再写连贯的画面描述。`;
        return prompt;
    },
};