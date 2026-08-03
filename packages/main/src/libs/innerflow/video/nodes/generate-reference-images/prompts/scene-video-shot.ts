// nodes/generate-reference-images/prompts/scene-video-shot.ts

/**
 * 场景镜头「视频」提示词生成。
 *
 * 与旧的 scene-shot（图像 I2I 单帧指令）本质不同：
 * 本节点产出的是**视频镜头描述**——全能参考出视频。它保留时序/运动动词、
 * 强调运镜与镜头内动作的连续性，绝不把动作冻结成静帧姿态。
 *
 * 输出仍是自然语言 markdown（不走 JSON），由下游视频节点直接消费或再翻译为
 * 目标视频引擎（如 Seedance）的最终指令。参考图由 reference_images 承载，
 * 提示词只需说明「如何使用参考图 + 本镜的运动/运镜/光影」。
 */
export const SCENE_VIDEO_SHOT_PROMPT = {
    system: (styleSection: string) =>
        `你是一名视频镜头提示词工程师。把分镜设计 + 参考图 + 场景光照，组合为「视频镜头」的自然语言导演指令（全能参考出视频）。

${styleSection}

---

**核心区别（视频而非静图）**：

- 你描述的是一段**会动的视频镜头**，不是一张静帧。
- **保留一切运动动词**（走近 / 转身 / 抬手 / 俯冲 / 坠落 / 掠过 / 缓步…），**绝不**把动作改写成凝固姿态（禁止"定格""静止的瞬间""冻结"这类会导致视频卡顿的措辞，除非剧情确需静止）。
- 明确镜头在这段时长内的**运镜轨迹**（推/拉/摇/移/跟/升降/固定）与**运动的起止**。
- 明确主体动作的**时序**（先做什么、再做什么），与运镜协同。

**输出结构（自然语言，两部分）**：

第一部分：参考图使用说明。格式：
"参考图使用说明：
1. [ref] 的参考图：[如何使用，如'严格保持脸部特征和五官比例'/'参考服装款式'/'作为环境基底，保持空间布局与光影基调']
2. ..."

第二部分：视频镜头描述。一段连贯自然语言，包含：
- 景别与运镜（本镜头如何运动，起止）
- 每个主体在这段时长内的**动作时序**（用连续的运动动词，保留动势）与表情变化
- 主体之间的空间关系与走位变化
- 本镜头的光影效果（基于场景光照）
- 时长内的节奏（快/慢、是否有停顿）
- 结尾：画质与风格锚定

**铁律**：
1. 动作用最简运动动词，保留动势；禁止角度数值、解剖学术语、厘米尺寸。
2. 只引用提供的参考图和实体，不臆造新实体。
3. 不重复参考图已锁定的静态外观细节（由参考图保证一致性），聚焦"运动 + 运镜 + 光影"。
4. 不出现 @{} 占位符、不出现 meta 声明、不输出编号前缀。`,

    user: (params: {
        sceneId: string;
        shotIndex: number;
        shotDescription: string;
        durationEstimate: string;
        cameraMovement: string;
        referenceImages: Array<{ entity_name: string; role: string }>;
        lightingText: string;
        inlineEntities: Array<{ name: string; description: string }>;
    }) => {
        let prompt = `【场景 ${params.sceneId} · 镜头 ${params.shotIndex}｜时长 ${params.durationEstimate}｜运镜 ${params.cameraMovement}】\n\n`;

        prompt += `【本镜分镜设计（含景别/运镜/画面描述/转场，运动动词须保留）】\n${params.shotDescription}\n\n`;

        if (params.referenceImages.length > 0) {
            prompt += `【可用参考图（按顺序，视频生成时会依次作为一致性参考）】\n`;
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

        prompt += `请输出本镜的**视频**镜头导演指令：先写参考图使用说明，再写保留运动动词、含运镜轨迹与动作时序的连贯视频镜头描述。`;
        return prompt;
    },
};