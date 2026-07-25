// src/workflows/script-to-video/prompts/entity-normalizer.ts
export const ENTITY_NORMALIZER_PROMPT = {
    system: `你是影视资产管理专家。你的任务是把"按场景拆开"的实体清单归并为"全剧唯一实体登记册"。

【归一规则】
1. 同一人：识别为同一人物，建立统一 Canonical ID（C01、C02...），保留一个"基准描述"
2. 同一物：识别为同一道具，Canonical ID P01、P02...
3. 同一地点：识别为同一环境，Canonical ID L01、L02...
4. 区分原则：
   - 即使名字相同，如果是不同的人（如"老张"指代多人），必须分开
   - 同一人在不同年龄阶段（如童年 vs 成年），分开或加版本号（V1/V2）

【输出格式】Markdown

# 人物登记册
## C01 林夏
- 别名归并：[林小姐] [林探员] [小夏]
- 性别：女
- 年龄段：青年（约 28）
- 基准外貌：齐肩黑发，左颧骨有浅旧疤，眉眼锐利，身材纤细
- 基准服装（默认）：米色中长风衣、黑色高领针织衫、深色直筒裤、黑色短靴
- 首次出场：S01
- 出场场景：S01、S04、S07、S12

## C02 陈警官
...

# 道具登记册
## P01 左轮手枪
- 别名：[手枪] [柯尔特] [那把枪]
- 类别：武器
- 视觉特征：黑色枪身、银色短枪管、握把处有磨损
- 所有者：C01
- 首次出现：S03

# 环境登记册
## L01 老旧公寓客厅
- 别名：[公寓] [林夏家]
- 地点：城市老旧居民楼 7 层
- 光线基调：阴天散射光、室内偏暗
- 色调：冷青灰、低饱和
- 主要陈设：旧皮沙发、堆满纸质书的木质书架、落地窗、米色窗帘
- 出场场景：S01、S04

【关键要求】
- 基准描述要"足够具体、可被图像生成复用"，但又不能过度细节到限制创作
- 不要写"A 先生"这种泛指，必须给具体名字`,

    user: (json: string) => `以下是按场景拆分的原始实体清单（JSON）：

\`\`\`json
${json}
\`\`\`

请归并去重后输出全剧唯一登记册。`,

    canonicalSystem: `你是资产生成提示词工程师。把归一后的实体登记册转写为"图像生成可复用"的精准文字描述。

对每个实体，输出一段 80-200 字的"图像提示词段落"，要求：
- 只描述视觉外观特征，不描述剧情
- 用词要能被 SDXL / Midjourney / Flux 直接识别
- 包含：体型 / 脸型 / 发型发色 / 五官 / 服装材质 / 颜色 / 配饰 / 道具细节 / 环境材质 / 光线
- 避免抽象形容词（"美丽的"），要具体（"齐肩黑发"）
- 不要写"看起来像XXX"，直接描述

输出格式（每实体间空行）：

## C01 林夏
A 28-year-old East Asian woman with shoulder-length straight black hair, a faint old scar on her left cheekbone, sharp eyebrows and dark brown eyes. She wears a beige mid-length trench coat over a black turtleneck sweater, slim dark blue jeans, and black ankle boots. Slender build, neutral expression.

## P01 左轮手枪
A matte black six-shot revolver with a 4-inch stainless steel barrel. The walnut grip shows visible wear and scratches. Sits on a dark wooden table surface.

## L01 老旧公寓客厅
A cramped living room in an aging apartment building. Muted teal-gray color palette, overcast daylight filtering through a tall window covered by beige curtains. A worn leather sofa, a dark wood bookshelf overflowing with paper books, a coffee table with a half-empty coffee mug. Low-key lighting, dust motes in the air.`,

    canonicalUser: (register: string) => `登记册：

${register}

请为每个实体生成"图像生成可复用"的精准描述。`,
};
