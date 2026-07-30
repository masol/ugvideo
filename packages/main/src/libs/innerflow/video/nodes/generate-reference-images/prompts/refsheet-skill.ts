// nodes/generate-reference-images/prompts/refsheet-skill.ts

/**
 * 预制 SKILL —— 参考图翻译步骤。
 * 全部基于"纯白背景、无光照、无动作"的约束。
 */

export const REFSHEET_SKILLS = {
    character_humanoid: `第1步：族裔锚定 —— 提取上游族裔面部特征（如"东亚汉族面部特征"），写入提示词开头。
第2步：身份串联 —— 年龄段 + 性别 + 体型整合为短语。
第3步：五官常见词化 —— 眼形/眉形/鼻型/唇形/颧骨/下颌用常见形容词。禁止解剖学术语。
第4步：发型发色 —— 发长 + 发质 + 发色 + 造型关键词。
第5步：肤色肤质 —— warm/cool/pale/olive/tan + skin tone。
第6步：服装逐层 —— 按 layer 从外到内，每件 [名称]: [廓形] + [材质] + [色彩]。
第7步：手部极简 —— "hands at sides"。禁止描述手指。
第8步：姿态锚定 —— "neutral standing pose, arms at sides, looking straight ahead"。
第9步：风格收尾 —— 按全局风格追加锚定短语。
注意：全程禁止写光照效果、场景环境、动作姿态变化、meta 声明。`,

    character_non_humanoid: `第1步：整体廓形 —— AI 可识别的英文基础实体名 + 2-3 个形态修饰词。
第2步：体表覆盖 —— 鳞/毛/羽/裸皮的覆盖范围 + 触感 + 排列方式。
第3步：主色光泽 —— 主色 + 色调偏向 + 光泽类型。
第4步：头部特征 —— 角/冠/须/吻/眼逐项。
第5步：躯干附肢 —— 数量 + 末端形态 + 尾末端。
第6步：尺寸锚点 —— 与已知动物对比。
第7步：姿态 —— "neutral position, body fully extended"。
第8步：风格收尾。
注意：禁止写光照、环境、动作、meta 声明。`,

    prop: `第1步：整体形态 —— 形状关键词 + 尺寸（与已知物体对比）。
第2步：主材质 —— 可触摸级 + 表面处理。
第3步：色彩色调 —— 含色调偏向。
第4步：纹样铭文 —— 类型 + 位置 + 工艺。
第5步：磨损年代 —— 使用痕迹。
第6步：配件组合 —— 多部件逐件。
第7步：风格收尾。
注意：禁止写握持动作、光照、环境、meta 声明。`,

    set: `第1步：整体形态尺寸 —— 形状 + 高度/宽度（与人体对比）。
第2步：主材质 —— 可触摸级。
第3步：色彩色调 —— 含色调偏向。
第4步：装饰纹样 —— 雕刻/镶嵌/彩绘，写明位置。
第5步：使用痕迹 —— 磨损/剥落/污渍。
第6步：环境附属 —— 共存小物件。
第7步：风格收尾。
注意：禁止写空间定位（参考图是白背景）、光照、meta 声明。`,

    uniform: `第1步：穿着者 —— 性别 + 标准体型 + 中性肤色 + 头发后梳。面部省略。
第2步：时代原型 —— 历史参照短语。
第3步：廓形描述 —— 关键词整合为自然语言。
第4步：构件逐层 —— layer 从外到内。
第5步：足部头饰配件。
第6步：风格收尾 —— "costume design reference, all garment details clearly visible"。
注意：禁止面部特征、光照、meta 声明。`,
} as const;

export type RefsheetSkillKind = keyof typeof REFSHEET_SKILLS;

export function getRefsheetSkill(kind: RefsheetSkillKind): string {
    return REFSHEET_SKILLS[kind];
}

export function pickRefsheetSkill(
    kind: string,
    humanoid: boolean,
): RefsheetSkillKind {
    if (kind === "character") return humanoid ? "character_humanoid" : "character_non_humanoid";
    if (kind === "prop") return "prop";
    if (kind === "set") return "set";
    return "prop";
}