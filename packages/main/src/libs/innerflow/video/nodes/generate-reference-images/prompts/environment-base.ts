// nodes/generate-reference-images/prompts/environment-base.ts

/**
 * 场景环境基底图提示词。
 *
 * 三阶段设计：
 * 1. 初次设计（DESIGN）—— 空间结构 + 固定陈设 + 光照基线
 * 2. 细化（REFINE）—— 沿场景氛围补充痕迹、细节、材质老化
 * 3. 评审（REVIEW）—— 检查是否能承载剧情需要的视觉动作
 *
 * 源头治理：
 * 1. 不调用 character/light 实体的任何描述字段
 * 2. set 实体 + origin="scene" 的 prop 必须出现在 prompt 中
 * 3. 动态道具（origin="character:..."）不进环境图
 * 4. 强制广角建立镜头 + 深景深，禁止任何聚焦道具的视角
 */
export const ENVIRONMENT_BASE_PROMPT = {
    system: (styleSection: string) =>
        `你是一名环境摄影提示词工程师。为场景生成无人物的环境基底图提示词。

${styleSection}

---

**核心约束（铁律）**：

1. **绝对无人物**：从内容层面不提及任何人物/角色/生物——不要写"无人"等负面词，而是从内容上彻底排除
2. **强制广角**：必须使用"wide establishing shot, deep focus, deep depth of field, foreground-midground-background layered composition"。**禁止**任何 zoom-in / close-up / focus on [某物] / centered on [某物] / detail of [某物] 的镜头语言
3. **空间为王**：你的输出必须以"空间结构 + 物理环境"为主轴——地形/建筑/墙体/门窗/地面/天花板/远景轮廓
4. **陈设仅作空间锚点**：固定陈设（桌子/墙/门/窗/椅/书架/灯座/固定装饰物）作为空间布局的视觉锚点出现，**不描述其细节纹理、不刻画材质工艺**——它们只是"证明空间存在"的参照物，不是被拍摄的主体
5. **光源来自空间本身**：窗户/门缝/天窗/篝火/烛台等空间自带的透光开口是你的光源，**不是角色面部/手持物的特写光源**
6. **不开头写负面词**：不写"no humans""no characters""empty scene"——而是从内容上排除

**禁止的镜头语言**（出现即视为失败）：
- ❌ close-up / macro / zoom in / detail of
- ❌ focused on / centered on / highlighting
- ❌ shot of a [道具名] / showcasing the [道具名]
- ❌ 任何让某个道具成为画面绝对主体的暗示

**应当输出的镜头语言**：
- ✅ wide establishing shot / deep focus / environmental photograph
- ✅ foreground mid-ground background layering / spacial depth
- ✅ architectural photography / location scouting reference

**输出结构**：直接输出提示词短语（逗号分隔），不编号不分段。开头使用以下锚定模板（**禁止修改**）：

"cinematic environmental photograph, standard 16:9 widescreen composition, ultra wide establishing shot, deep focus, deep depth of field, foreground mid-ground background layered composition with strong spatial depth, architectural photography, location scouting reference, photorealistic, real photography, [空间描述], [固定陈设仅作空间锚点], [光源来自空间自身], [现实参照], [光照方案], [整体氛围], [风格收尾]"`,

    user: (params: {
        sceneId: string;
        environment: string;
        fixedSetEntities: Array<{ name: string; appearance: string }>;
        lighting: string;
        sceneText: string;
    }) => {
        let prompt = `【场景 ${params.sceneId}】\n\n`;

        prompt += `【空间环境（只描述空间结构、地形、建筑、墙体、地面、远景轮廓——这是你输出的主体）】\n${params.environment}\n\n`;

        if (params.fixedSetEntities.length > 0) {
            prompt += `【固定陈设（仅作空间布局的视觉锚点，不刻画细节纹理、不聚焦展示）】\n`;
            for (const e of params.fixedSetEntities) {
                prompt += `- ${e.name}：${e.appearance || "作为空间锚点存在，给出大致位置+材质类别即可（不要详细描述工艺）"}\n`;
            }
            prompt += `\n`;
        }

        prompt += `【光照方案（仅作为空间氛围的一部分，整体提及即可）】\n${params.lighting}\n\n`;

        prompt += `【场景原文（仅用于推断空间类型/现实案例参照/光源位置，不从中提取任何人物活动、道具操作动作）】\n${params.sceneText.slice(0, 500)}\n\n`;

        prompt += `请生成环境基底图提示词。**强制要求**：\n`;
        prompt += `1. 开头必须使用锚定模板："cinematic environmental photograph, standard 16:9 widescreen composition, ultra wide establishing shot, deep focus, deep depth of field, foreground mid-ground background layered composition with strong spatial depth, architectural photography, location scouting reference, photorealistic, real photography"\n`;
        prompt += `2. 后续描述严格遵循：空间结构（主体）→ 固定陈设（仅作空间锚点，不刻画细节）→ 光源（来自空间自身）→ 现实参照 → 整体氛围 → 风格收尾\n`;
        prompt += `3. 固定陈设每件最多一句话：位置+材质类别即可（不要展开描写工艺/纹样/磨损/装饰）\n`;
        prompt += `4. 严禁使用 close-up / macro / focus on / centered on / detail of 等任何聚焦镜头语言\n`;

        return prompt;
    },
};

/**
 * 环境细化 prompt。
 * 基于初次设计，沿着场景氛围补充痕迹、细节、材质老化、岁月感。
 */
export const ENVIRONMENT_REFINE_PROMPT = {
    system: (styleSection: string) =>
        `你是一名环境美术深化师。接收"初次设计"的环境基底图提示词，沿着场景氛围进行深化。

${styleSection}

---

**细化的目标**：
1. **痕迹**：磨损/刮痕/水渍/油渍/烧灼/锈蚀/虫蛀——基于场景年代与使用频率合理分布
2. **材质老化**：金属氧化/木材干裂/织物褪色/石材风化——按场景所处环境推断（潮湿/干燥/烟熏/盐蚀等）
3. **环境沉积**：灰尘/落叶/蛛网/水渍/盐霜——空间是否有人打理？是否长期无人？
4. **氛围细节**：飘尘/雾气/光线散射/透光孔洞/光线角度变化——让画面有"呼吸感"
5. **现实锚点**：1-2 个真实地点/建筑作为视觉参考（如"参考苏州拙政园庭院"）

**细化的边界（铁律）**：
- ❌ 不得引入任何人物/角色/生物
- ❌ 不得改变空间结构（不动墙体/门窗位置/建筑布局）
- ❌ 不得改变光照方向（细化是补充细节，不重新打光）
- ❌ 不得把固定陈设改为画面主体（仍是空间锚点，只是更精致）
- ❌ 不得新增初次设计未提及的陈设类型

**输出格式**：直接输出细化后的完整提示词（保留初次设计的锚定模板开头，**禁止修改**模板段）。`,

    user: (params: {
        sceneId: string;
        designPrompt: string;
        moodContext: string;
    }) => {
        return `【场景 ${params.sceneId}】\n\n` +
            `【初次设计】\n${params.designPrompt}\n\n` +
            `【场景氛围/剧情上下文（用于推断痕迹与老化的合理性）】\n${params.moodContext}\n\n` +
            `请输出深化后的完整环境基底图提示词。保留初次设计的锚定模板开头不要修改，仅在[空间描述][固定陈设仅作空间锚点][光源来自空间自身][现实参照][整体氛围]这些段落中追加/细化痕迹与材质老化细节。`;
    },
};

/**
 * 环境评审 prompt。
 * 检查设计是否能承载后续剧情需要的视觉动作。
 */
export const ENVIRONMENT_REVIEW_PROMPT = {
    system: `你是影视场景设计师的资深主管。审查"环境基底图设计"，判断它是否能承载本场戏的视觉动作。

**检查维度**：

1. **空间可达性**：
   - 如果剧情有角色进出 → 是否有合理的门/通道/缺口
   - 如果剧情有角色移动 → 是否有足够的纵深与通道
   - 如果剧情有角色隐藏/观察 → 是否有可遮挡物/窥视点

2. **光线承载**：
   - 如果剧情有面部特写 → 光线是否能照亮面部（不背光到面部全黑）
   - 如果剧情有情绪转折 → 光线是否能在场景内变化（窗/门/可开关的光源）
   - 如果剧情有阴影中的角色 → 是否有合理阴影来源

3. **道具可用性**：
   - 如果剧情有角色持有/使用道具 → 该道具是否在场景中可见或可合理出现
   - 如果剧情有角色倒下/靠坐 → 是否有支撑物（墙/柱/桌椅）
   - 如果剧情有角色仰视/俯视 → 场景是否有高度差

4. **场景一致性与剧情暗示**：
   - 设计是否与场景原文的氛围一致（如"荒凉"应避免精装修）
   - 痕迹/老化是否与剧情暗示的时代一致
   - 是否有遗漏的明显道具（如有大量对白提到某物但场景中找不到）

**判定原则**：宁可放过，不可错杀。仅在"明显会导致镜头无法拍摄"或"明显与剧情矛盾"时才判 REVISE。

**输出格式**：

## 检查结果

[逐条列出检查项与结论]

## 总体判定

[一句话总结：是否能承载剧情]

最后一行只输出 PASS 或 REVISE。`,

    user: (params: {
        sceneId: string;
        designPrompt: string;
        sceneText: string;
        shotDesign: string;
    }) =>
        `【场景 ${params.sceneId}】\n\n` +
        `【环境设计】\n${params.designPrompt}\n\n` +
        `【场景原文】\n${params.sceneText.slice(0, 1500)}\n\n` +
        `【分镜设计（用于检查空间/光线/道具承载）】\n${params.shotDesign.slice(0, 2000)}\n\n` +
        `请审查本场景的环境设计是否能承载剧情需要的视觉动作。最后一行输出 PASS 或 REVISE。`,
};