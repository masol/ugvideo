# 参考图生成（generate-reference-images）—— 架构设计

> 「剧本 → 视频」工作流第四步。本节点的核心职责是：
> **为每个实体生成定妆照提示词，为每个场景生成环境基底图提示词**。
>
> 上游依赖：design-shots（素材描述 + 分镜设计 + 场景光照）+ align-entities（全局实体登记册）。
> 下游消费：图像生成引擎（读提示词 + 参考图依赖关系 → 生成定妆照和环境图）。

---

## 0. 一句话目标

把上游设计节点产出的结构化视觉描述，转化为 AI 图像生成引擎可直接消费的提示词，
并维护参考图之间的依赖关系（角色 → 角色/道具/场景；环境 → 实体集合）。

---

## 1. 核心取舍

- **不做新设计**。本节点是纯翻译器，所有视觉描述来自上游。
- **AI 引擎友好性优先**。用常见词、简单动词、明确颜色，避免"颧骨高点定位於眼眶外侧垂直线下方1.2厘米处"这类学术精度描述。
- **参考图依赖用占位符**。提示词中用 `@{entity_name}` 标记参考图，方便下游正则替换为实际图片路径。
- **环境图从现实案例参照**。每个环境图提供 1-2 个现实世界地点/建筑作为视觉锚点。

---

## 2. 数据分表

| 表               | KV key                              | 作用域 | 内容                                   |
| ---------------- | ----------------------------------- | ------ | -------------------------------------- |
| 实体定妆照提示词 | `#video:refimg:entity_{globalName}` | 单实体 | 提示词 + 参考图依赖列表                |
| 场景环境图提示词 | `#video:refimg:env_{sceneId}`       | 单场景 | 提示词 + 参考图依赖列表 + 现实案例参照 |
| 已生成实体索引   | `#video:refimg:idx:entities`        | 全局   | 已生成定妆照的实体名列表               |
| 已生成场景索引   | `#video:refimg:idx:scenes`          | 全局   | 已生成环境图的场景 id 列表             |
| 总览             | `#video:output:refimg_overview`     | 全局   | 人类可读拼接                           |

---

## 3. 处理流程

```
gate(inputs: shots:idx:scenes + stage:registry:idx, outputs: output:refimg_overview)
  → pMap(entities, generateEntityRefsheet)  // 并发生成实体定妆照
  → pMap(scenes, generateSceneEnvironment)  // 并发生成场景环境图
  → buildOverview
```

### Pass A｜实体定妆照生成

- 输入：`#video:shots:asset_{sceneId}_{globalName}`（上游素材描述）
- 输出：
  - 提示词（21:9 横构图，四列或三列布局）
  - 参考图依赖列表（当前实体可能依赖的其他实体定妆照）

**构图规则**：

- character（类人=是）→ 四列布局（正面/左侧45°/右侧45°/背面）
- character（类人=否）→ 三列布局（正面/侧面/背面）
- prop/set → 三列布局（正面/侧面/背面）
- light → 不生成定妆照（光源由场景环境图承载）

**参考图依赖识别**：

- 如果实体 A 的 `base_description` 中提到"与 B 相似的五官"或"参考 C 的体型"，
  则 A 依赖 `@{B}` 或 `@{C}`。
- 当前实现：简单版不做语义解析，仅记录依赖为空数组。后续可扩展 LLM 解析依赖。

### Pass B｜场景环境图生成

- 输入：
  - `#video:state:stage_{sceneId}`（场景静态舞台）
  - `#video:shots:lighting_{sceneId}`（场景光照）
  - `#video:output:aligned_text_{sceneId}`（名称对齐后原文，用于推断现实案例）
- 输出：
  - 提示词（16:9 横构图，无人物）
  - 参考图依赖列表（本场景所有实体的定妆照）
  - 现实案例参照（1-2 个真实地点/建筑名称）

**现实案例推断**：

- 从场景原文的地点描述（如"中式禅院""老旧公寓客厅"）推断 1-2 个真实参照。
- 示例：
  - "中式禅院" → "参考苏州拙政园庭院、日本龙安寺石庭"
  - "老旧公寓客厅" → "参考1980年代上海老公房室内、香港九龙城寨单元"
- 当前实现：用简单规则匹配（中式→苏州园林，日式→京都寺庙，欧式→巴黎建筑等）。
  后续可扩展 LLM 推断。

**参考图依赖**：

- 本场景所有 character/prop/set 实体的定妆照都是依赖项。
- 提示词中用 `@{entity_name}` 占位符引用。

---

## 4. 提示词生成原则

### 4.1 AI 引擎友好性（最高优先级）

**禁止的词汇类型**：

- 角度数值（15°、45°、110°）
- 厘米/毫米级尺寸
- 百分比（18%、65%）
- 解剖学术语（胸锁乳突肌、颧骨高点、尺侧）
- 色值（#C8A88A、RGB）

**用什么替代**：

- ❌ "颧骨高点定位於眼眶外侧垂直线下方1.2厘米处" → ✅ "高颧骨，棱角分明"
- ❌ "躯干前倾15°" → ✅ "身体微微前倾"
- ❌ "瞳孔直径较常态扩大18%" → ✅ "瞳孔放大"
- ❌ "肩宽精确为头部正面投影宽度的3倍" → ✅ "宽肩"

**描述重心分配**（实体定妆照）：

- 70% 给：整体轮廓 + 主色 + 材质质感 + 光影
- 20% 给：服装/表面纹理具体构件
- 10% 给：姿态动作（用最简动词）

### 4.2 手部极简化

- 不描述手指数量、关节角度、指间距
- 只写手的整体状态：握拳 / 摊开 / 持物 / 垂放 / 背后

### 4.3 动作用最简单的动词

- ❌ "单膝压地+躯干前倾15°的受压姿态" → ✅ "单膝跪地"
- ❌ "右前臂尺侧轻贴桌面" → ✅ "右手撑桌"

### 4.4 颜色必须具体且含色调

- ❌ "黑" → ✅ "冷调炭黑"
- ❌ "白" → ✅ "泛黄生白"
- ❌ "红" → ✅ "深朱红偏冷"

### 4.5 材质可触摸级

- ❌ "布料" → ✅ "靛蓝染色手织粗棉平纹布"
- ❌ "皮革" → ✅ "油鞣深褐色牛皮，表面磨损泛光"

---

## 5. 提示词结构

### 5.1 实体定妆照（21:9 横构图）

```
[1] 图像类型与构图锚定（含21:9横构图 + 四列/三列布局）
[2] 实体基础特征（来自 base_description，AI 友好化）
[3] 本场景变化（来自 scene_delta，用最简动词）
[4] 光影效果（来自 lighting_effect，自然语言，不写光比数值）
[5] 参考图依赖（若有）：@{依赖实体名}
[6] 真实照片级收尾（肯定句，反插画/反CG）
```

**[1] 锚定段示例**（类人角色，四列布局）：

```
EN: "cinematic photorealistic character reference sheet, ultra-wide 21:9 horizontal layout,
     four-column turnaround — front view, left 45° view, right 45° view, back view,
     same person consistently across all four views, identical face and proportions,
     plain white background, neutral standing pose, arms at sides,
     soft even studio lighting, natural skin tones, full-frame DSLR photograph,
     ultra realistic skin texture, real human"

ZH: "电影感真实照片级角色定妆照，超宽21:9横构图，
     四列转身图——正面视角、左侧45°视角、右侧45°视角、背面视角，
     四视角为同一真人，面部与比例完全一致，
     纯白背景，中性站立姿态，双臂自然垂放，
     柔和均匀影棚光，自然肤色，全画幅DSLR照片，
     超写实皮肤纹理，真人"
```

**[1] 锚定段示例**（道具，三列布局）：

```
EN: "product photography reference sheet, ultra-wide 21:9 horizontal layout,
     three-column turnaround — front view, side view, back view,
     same object consistently across all three views, identical form and surface,
     plain white background, neutral position,
     soft even studio lighting revealing material texture,
     professional product photograph, ultra realistic surface detail"

ZH: "产品摄影参考图，超宽21:9横构图，
     三列转身图——正面视角、侧面视角、背面视角，
     三视角为同一物体，形态与表面完全一致，
     纯白背景，中性摆放，
     柔和均匀影棚光呈现材质纹理，
     专业产品照片，超写实表面细节"
```

### 5.2 场景环境图（16:9 横构图，无人物）

```
[1] 图像类型与构图锚定（16:9横构图 + 环境摄影 + 无人物强调）
[2] 现实案例参照（1-2个真实地点/建筑）
[3] 场景空间描述（来自 stage.world.environment，AI 友好化）
[4] 固定地标与陈设（来自 stage.entities 中的 set 类，剥离人物活动痕迹）
[5] 光照方案（来自 lighting，四层完整）
[6] 色彩与氛围（来自 scene_palette）
[7] 参考图依赖：@{场景内所有实体}
[8] 真实照片级收尾 + 无人物强调
```

**[1] 锚定段示例**：

```
EN: "cinematic environmental photograph, standard 16:9 widescreen composition,
     wide establishing shot capturing the full breadth of the space,
     no人物, no characters, no人, empty scene, uninhabited,
     architectural photography, location scouting reference,
     natural light, photorealistic, real photography"

ZH: "电影感环境摄影照片，标准16:9宽屏构图，
     广角建立镜头捕捉完整空间，
     无人物，无角色，无人，空场景，无人居住，
     建筑摄影，场景勘景参考，
     自然光，照片级真实，真实摄影"
```

**[2] 现实案例参照示例**：

```
EN: "inspired by the courtyard layout of Suzhou Humble Administrator's Garden
     and the stone garden of Kyoto Ryoan-ji Temple"

ZH: "参考苏州拙政园庭院布局与京都龙安寺石庭"
```

---

## 6. 参考图依赖维护

### 6.1 占位符格式

- 单个实体：`@{entity_name}`
- 多个实体：`@{entity_A}, @{entity_B}, @{entity_C}`

示例：

```
"the character's facial structure references @{豢龙氏},
 body proportions similar to @{林乃龙}"
```

### 6.2 依赖解析（当前简化版）

- 实体定妆照：`dependencies: []`（暂不解析语义依赖）
- 场景环境图：`dependencies: [本场景所有character/prop/set的globalName]`

### 6.3 下游使用

下游图像生成节点读取提示词后：

1. 正则匹配 `@\{([^}]+)\}` 提取所有依赖实体名
2. 从 Storage 读取每个依赖实体的已生成图片路径
3. 替换占位符为实际路径（或传给 I2I 引擎）

---

## 7. 与 design-shots 的衔接

- 实体基础描述：读 `#video:shots:asset_{sceneId}_{globalName}` 的 `base_description`
- 实体本场变化：读同上的 `scene_delta`
- 实体光影：读同上的 `lighting_effect`
- 场景环境：读 `#video:state:stage_{sceneId}`
- 场景光照：读 `#video:shots:lighting_{sceneId}`

---

## 8. 下游接线

- **图像生成节点**：读 `#video:refimg:entity_*` 和 `#video:refimg:env_*`，
  调用 Stable Diffusion / Midjourney / DALL-E 生成图片。
- **视频生成节点**：读环境图 + 实体定妆照，用 I2I 合成最终视频帧。
