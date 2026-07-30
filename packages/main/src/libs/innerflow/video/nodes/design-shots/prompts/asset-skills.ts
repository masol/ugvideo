// nodes/design-shots/prompts/asset-skills.ts

/**
 * 预制 SKILL 常量 —— 素材视觉扩写的固定过程式步骤。
 * 取代原先"每次 LLM 生成 asset_skill"的路径。
 *
 * 素材扩写只做"翻译/整合"——身份/族裔/服装由上游 design-characters 提供，
 * 本节点负责把它们组织成 AI 引擎友好的连贯描述。
 */

export const ASSET_SKILLS = {
    /** 类人角色（character + humanoid） */
    character_humanoid: `第1步：族裔锚定 —— 提取上游"族裔面部特征"（如"东亚汉族面部特征"），**必须写入基础描述开头**，禁止漂移。
第2步：身份特征串联 —— 身份 + 年龄段 + 性别 + 体型整合为一句短语，紧跟族裔之后。
第3步：五官常见词化 —— 眼形/眉形/鼻型/唇形/颧骨/下颌逐项翻译为常见形容词（深邃/扁平/丰厚/棱角分明/圆润）。**禁止解剖学术语与数值角度**。
第4步：发型与发色 —— 发长 + 发质 + 发色（含色调）+ 造型关键词（束起/披散/盘起），不写"飘逸""灵动"等抽象词。
第5步：肤色与肤质 —— 用"warm/cool/pale/olive/tan + skin tone"；肤质写"natural pores/visible pores/smooth"。
第6步：服装整合 —— 按上游 design-characters 的 [服装设计] 字段，按 layer 从外到内逐件描述 [名称]: [廓形] + [材质] + [色彩]。**材质不得泛化、色彩不得简化为单字**。
第7步：本场变化 —— 若有 scene_delta（换装/受伤/脏污/姿态），用最简动词描述（单膝跪地/右手撑桌/皱眉）。无则省略此步。
第8步：手部极简化 —— "hands at sides" / "one hand holding [道具名]"，**禁止描述手指角度与数量**。
第9步：光影效果 —— 按场景光照，用自然语言描述受光（暖黄侧光/冷蓝逆光/柔和散射），不写光比数值与色温 K 值。
第10步：重要性 —— primary（individual_refsheet）/ secondary（prompt_only），按上游决策填写。`,

    /** 非类人角色（character + !humanoid，如龙/兽/精怪） */
    character_non_humanoid: `第1步：整体廓形锚定 —— 用 AI 可识别的英文基础实体名 + 2-3 个整体形态修饰词（serpentine/quadrupedal/bipedal with wings）。
第2步：体表覆盖 —— 区分鳞/毛/羽/裸皮，写"覆盖范围 + 触感描述 + 排列方式"（diamond-shaped hard keratin scales, smooth polished surface, overlapping like roof tiles）。
第3步：主色与光泽 —— "主色 + 含色调偏向 + 光泽类型"（warm amber-gold primary with satin sheen）。**禁止单字颜色**。
第4步：头部特征 —— 角/冠/须/吻/眼逐项，含数量+形态参照已知动物+材质+色。无则省略。
第5步：躯干与附肢 —— 数量+末端形态（鹰爪/熊掌/蹄），尾末端形态（鳍/锤/流苏）。
第6步：尺寸锚点 —— 必须含与已知动物的对比（body length approximately 3 times an adult Asian elephant）。
第7步：本场变化 —— 受伤/脏污/姿态变化（最简动词）。
第8步：构图关键词 —— 若 lateral_view_primary=true，强制使用 "full body lateral view, side profile, body fully extended horizontally, wide landscape canvas"。
第9步：光影效果 —— 按场景光照，自然语言描述。
第10步：重要性 —— primary/secondary 按上游决策填写。`,

    /** 道具（prop） */
    prop: `第1步：整体形态 —— 形状关键词（cylindrical/spherical/flat/irregular）+ 尺寸（与已知物体对比）。**禁止泛化尺寸**（如"中等大小"）。
第2步：主材质与表面处理 —— 可触摸级材质 + 处理方式（lacquered/oil-tanned/hammered/polished/weathered）。
第3步：色彩与色调 —— 含色调偏向（cool charcoal-black / warm amber-gold）。**禁止单字颜色**。
第4步：纹样与铭文 —— "纹样类型 + 位置 + 工艺"（engraved at the hilt, embossed on the lid）。
第5步：磨损与年代 —— 表面使用痕迹（scratches at the base, patina on metal fittings）。
第6步：配件与组合件 —— 若由多部件组成，逐件描述。
第7步：握持提示 —— 若被角色持握，写"one hand gripping at [位置]"。
第8步：本场变化 —— 状态变化（沾染/破损/新刻痕）。
第9步：光影效果 —— 受光描述。
第10步：重要性 —— primary（剧情关键道具/独立出图）/ secondary（背景道具/仅文字）。`,

    /** 陈设（set，固定场景物件） */
    set: `第1步：空间定位 —— 此陈设在空间中的位置（against the north wall / centered on the stage）。
第2步：整体形态与尺寸 —— 形状 + 高度/宽度（与人体或已知物体对比）。**禁止泛化尺寸**。
第3步：主材质 —— 可触摸级（aged oak / carved granite / hammered iron）。**禁止泛化材质**（如"石头""木材"）。
第4步：色彩与色调 —— 含色调偏向，区分新旧。
第5步：装饰与纹样 —— 雕刻/镶嵌/彩绘/铭文，写明位置。
第6步：使用痕迹 —— 磨损、剥落、污渍、岁月感。
第7步：环境附属 —— 与此陈设共存的小物件（桌上的茶盏、地面的蒲团）。
第8步：本场变化 —— 状态变化（被移动/被损坏/新摆设）。
第9步：光影效果 —— 受光描述。
第10步：重要性 —— primary（核心场景标志性陈设）/ secondary（背景物件）。`,

    /** 光源（light，本节点基本不处理，但兜底） */
    light_skip: `第1步：跳过 —— 光源类实体不单独出图，光照由场景环境图承载。
本类实体在本节点产出空素材描述即可。`,
} as const;

export type AssetSkillKind = keyof typeof ASSET_SKILLS;

export function getAssetSkill(kind: AssetSkillKind): string {
    return ASSET_SKILLS[kind];
}

/** 根据实体类别与属性挑选 skill 类别 */
export function pickAssetSkill(
    kind: string,
    humanoid: boolean,
): AssetSkillKind {
    if (kind === "character") return humanoid ? "character_humanoid" : "character_non_humanoid";
    if (kind === "prop") return "prop";
    if (kind === "set") return "set";
    if (kind === "light") return "light_skip";
    return "prop"; // fallback
}