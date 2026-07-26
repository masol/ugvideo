# 导演台（Director Stage）世界模型 —— 架构设计

> 本文件是「剧本 → 视频」工作流第二步「构建世界模型」的权威设计说明，
> 供后续节点（分镜、光源、首尾帧、分层提示词、运镜、出图、VLM 校验）实现，
> 以及未来 Stage 结构演进时参考。

---

## 0. 一句话目标

把每个场景还原成一个**可脱离剧本原文、独立驱动全部下游提示词**的世界模型：
谁在场、长什么样、在哪、拿着什么（哪只手）、这一拍在做什么、什么情绪、
和跨场景的「同一个人/同一件道具」如何对齐、第一次出的图存在哪。

后续所有提示词（文生图 / 图生视频 / 对话 TTS / BGM）都从 Stage 及其配套表读取，
以 ReAct 方式设计，并由 Stage 反过来验证。**剧本原文只在本步骤被读一次。**

---

## 1. 核心取舍：拓扑，而非几何

当前文生图 / 图生视频对空间的需求很浅：
- 人物之间的**相对拓扑**（谁左谁右、谁前谁后、谁靠着谁）；
- 人物的**粗略坐标**（用于「镜头里有谁、构图空区」这类判断）；
- **持有关系** + **哪只手**；
- 只有**大件物体**（家具、布景、车）才需要尺寸/包围盒参与遮挡判断。

原文本身也不会给精确坐标——它靠读者脑补出一个「想象的物理世界」。
所以 Stage 维护的是**梦境级物理**：视角范围内拓扑自洽即可，不追求物理精确。

**工程后果**：
- 布局求解器（layout-solver）从「160 次约束松弛 + 防重叠」降级为
  轻量拓扑摆放（少量迭代满足方向/贴近，堆叠链定高，持有物附着到持有者）。
- `holds`（持有）**不再当作竖直堆叠**（旧代码把人堆到枪顶上的 bug 根因），
  改为「附着到持有者、手部高度、记录左右手」。
- 三维引擎 `stage-engine.ts`（视锥/投影/遮挡）保留但**不是中心**，
  留给未来分镜阶段做「镜头里有谁 + 包围盒 + 构图空区」演算，粗坐标足够喂它。

---

## 2. 数据分表（为什么拆，怎么拆）

Stage 不是一张大表，而是**一组正交的表**，各自独立时效、独立演进：

| 表 | KV 前缀 | 作用域 | 内容 | 变动频率 |
|---|---|---|---|---|
| 全局实体登记册 | `stage:registry:*` | 跨场景 | canonical 外观、对齐描述、图片历史 | 低（对齐时增改） |
| 场景静态舞台 | `stage:scene:*` | 单场景 | world、局部实体（含 ref）、粗布局 | 中 |
| 节拍时间线 | `stage:beats:*` | 单场景 | beat 序列（时长/动作/台词/持有/状态增量/情绪） | 中 |
| 场景情绪简报 | `stage:emotion:*` | 单场景 | 场景情绪/意图/氛围（NL） | 中 |
| 资产图索引 | `asset:*`（下游写） | 实体/分镜 | 出图 URL、锚定首图 | 高 |
| 下游总览 | `state:stages_nl` | 全局 | 所有导演台的自然语言概览 | 派生 |

拆表理由：

1. **动态变化必须独立于静态舞台**。beat 序列是「时间维度」，静态舞台是
   「空间维度快照」。二者变动原因不同（改台词 vs 改站位），耦合在一起会
   互相触发无谓重算。→ `stage:beats:*` 独立成表。
2. **全局实体表必须独立于场景**。同一个「林夏」跨 S001/S004/S012 出现，
   外观（canonical）是全局属性；「本场风衣右袖撕裂」是场景局部属性。
   前者进 `stage:registry:*`，后者进场景实体的 `scene_overrides`。
3. **图片历史挂在全局实体上**，用于反查「这个实体在哪些场景出过图」，
   并判断**首次出图 vs 二次出图**：二次出图必须索引锚定首图（anchor）
   做外观一致性（IP-Adapter / reference-only）。→ `GlobalEntity.image_history`。

---

## 3. 全局实体登记册（跨场景身份 + 出图记忆）

```
stage:registry:idx            => ["C01","C02","P01","L01","LT01", ...]
stage:registry:{gid}          => GlobalEntity
```

`gid` 前缀按类别：`C`=character，`P`=prop，`L`=set(location/布景)，`LT`=light。

```ts
interface GlobalEntity {
  gid: string;
  kind: "character" | "prop" | "set" | "light";
  name: string;                 // 规范名，如「林夏」
  aliases: string[];            // 别名归并
  size_class: SizeClass;

  // 出图用：T2I 可直接复用的 canonical 外观（英文/中文皆可，越具体越好）
  canonical_appearance: string;

  // 对齐用：稳定的、区分性强的识别特征（跨场景不变的锚点）
  // 后续场景抽到新实体时，拿它的 alignment_hint 与本字段做匹配判断
  alignment_desc: string;

  first_scene: string;
  image_history: EntityImageRef[];
}

interface EntityImageRef {
  scene_id: string;
  beat_index?: number;
  asset_key: string;   // 指向 asset:* 的 key（真正的图 URL 由出图节点写）
  is_anchor: boolean;  // 该实体的锚定首图；二次出图索引它
}
```

**首次/二次出图判定**（未来出图节点用）：
- `getAnchorImage(gid)` 无返回 → 首次出图，出完后 `recordImage(gid, {is_anchor:true})`；
- 有返回 → 二次出图，把锚图作为 reference 传给出图模型，出完后
  `recordImage(gid, {is_anchor:false})`。

---

## 4. 场景静态舞台

```
stage:idx                     => [sceneId...]（按行号有序 = 叙事顺序）
stage:scene:{sceneId}         => SceneStage
```

```ts
interface StageEntity {
  id: string;               // 场景内局部 id，如 e01
  ref?: string;             // 对齐后指向 registry 的 gid；未对齐为 undefined
  kind: EntityKind;
  label: string;            // 本场称呼
  sizeClass: SizeClass;

  // 本场景相对 canonical 的差异（伤痕/服装破损/沾染等），供出图叠加
  scene_overrides?: string;

  // 对齐提示：抽取时留下的稳定识别特征，供对齐节点判断是否同一实体
  alignment_hint: string;

  // 本场首次可见时的外观（供新建全局实体时作为 canonical 初值）
  appearance: string;
}

interface EntityTransform {          // 粗坐标，梦境级物理
  id: string;
  position: [number, number, number];
  facing: number;                    // 偏航角(度)，0=面向+z
  size: [number, number, number];
}

interface SceneStage {
  world: StageWorld;                 // 环境 + 尺度 + 主光基调
  entities: StageEntity[];
  base_layout: EntityTransform[];    // 开场基准布局（拓扑求解产物）
}

interface StageWorld {
  scene_id: string;
  environment: string;               // 布景 NL：地点/光线/色调/材质/氛围
  floor_width: number;
  floor_depth: number;
  ceiling_height: number;
  key_light: string;                 // 主光基调 NL：方向/色温/软硬（光源规划入口）
}
```

坐标系约定（世界系，米）：`+x`=右，`-x`=左，`+z`=靠前(近机位)，`-z`=靠后，`+y`=上。

---

## 5. 节拍时间线（动态变化，独立表）

```
stage:beats:{sceneId}         => Beat[]
```

```ts
interface Beat {
  index: number;
  duration_hint?: string;    // 语义时长，如「约3秒」，供运镜/音频时序参考
  summary: string;           // 这一拍发生了什么
  mood?: string;             // 本拍情绪基调
  relations: SpatialRelation[]; // 本拍新增/改变的拓扑关系（含 holds+hand）
  deltas: BeatDelta[];       // 各个体并行的动作/台词/状态增量
}

interface SpatialRelation {
  subject: string;
  relation: RelationKind;    // left_of/right_of/in_front_of/behind/on_top_of/near/next_to/holds/at
  object: string;
  hand?: "left" | "right" | "both";  // 仅 holds 用
  note?: string;
}

interface BeatDelta {
  entity_id: string;
  action?: string;           // 视觉可见动作
  dialogue?: string;         // 台词原文（对话提示词来源）
  holds?: { object_id: string; hand?: "left"|"right"|"both" }[];
  moves_to?: string;
  new_facing?: string;
  appearance_change?: string;// 本拍视觉状态增量（伤痕/服装破损/沾染），累积到实体状态
  mood?: string;             // 该个体本拍情绪（TTS 语气来源）
}
```

**动态状态如何被下游用**：首尾帧节点按目标 beat，把 `base_layout` +
截至该 beat 的所有 `appearance_change` 累积，叠加到实体 canonical 外观，
得到「此刻该实体长什么样」。这就是脱离剧本也能出图的关键。

---

## 6. 场景情绪简报

```
stage:emotion:{sceneId}       => string(NL)
```

场景级情绪/意图/张力/节奏（自然语言）。用于 BGM 风格选择、TTS 语气基调、
以及分镜的构图/色调取向。与 beat 内的 per-delta mood 互补（一个宏观、一个微观）。

---

## 7. 多次 LLM 提取（按 LLM 擅长拆分）

一次 LLM 干不好这么多异质任务，且要为跨场景对齐留描述。拆为四类 pass：

**Pass A｜实体 + 世界 + 拓扑**（`entity-analyzer`，Reasoning+Outline）
- 判定环境与粗尺度、主光基调；
- 清点实体（含 `appearance` 外观 + `alignment_hint` 对齐特征）；
- 开场初始拓扑关系（含 holds + hand）。
- NL → safefmt 结构化。

**Pass B｜节拍时间线**（`beat-analyzer`，Reasoning）
- 复用 Pass A 的实体编号（roster 注入，不新造）；
- 切 beat：时长、概括、情绪、拓扑变化、各体动作/台词/持有/状态增量。
- NL → safefmt。

**Pass C｜情绪简报**（`emotion-analyzer`，Reasoning）
- 纯 NL 产出，下游 NL 消费，不需结构化。

**Pass D｜跨场景对齐**（`entity-aligner`，Reasoning，**顺序执行**）
- Pass A/B/C 可按场景并发；对齐必须按叙事顺序**串行**，
  因为登记册是增长的：S004 的实体要和 S001 已入册的实体比对。
- 逐场景、逐实体，用 `alignment_hint` 与登记册每条 `alignment_desc` 匹配：
  - 命中 → 该局部实体 `ref = gid`，并把本场景登记进图片历史锚点候选；
  - 未命中 → 新建 `GlobalEntity`（canonical 取本场 appearance，
    alignment_desc 取 alignment_hint），回写 `ref`。
- 光源（light）不入全局登记册（场景局部即可）。

流程编排（index.ts）：
```
gate(inputs: parse:idx:scenes, outputs: state:stages_nl)
  → pMap(scenes, buildSceneStage)   // A+B+C 并发，落 stage:scene/beats/emotion
  → for scene in order: alignScene  // D 串行，填 ref + 建 registry
  → summary → state:stages_nl
```

---

## 8. 与 parse-script 的衔接

- 门控源为 **`parse:idx:scenes`**（真正的上游产出），不是 `script`。
  用 `script` 会在「剧本没变但 parse 重跑出新场景」时误判新鲜而跳过。
- 行号口径与 parse 一致：`scriptArray.join("\n\n").split(/\n/)`，
  1-based 行号 = 下标+1，与 `PersistedScene.line_start/line_end` 对齐。
- parse 已给 `context.charactersInvolved`，作为 Pass A 抽取人物的种子，
  减少漏人并为对齐提供锚点。

---

## 9. 未来接线（本步骤不实现，占位说明）

- 分镜阶段：读 scene+beats+emotion+registry，ReAct 设计镜头 →
  用 `resolveBeatLayout` 解算目标 beat 快照 → `DirectorStage.computeShot`
  出「镜头里有谁 + 包围盒 + 构图空区」→ LLM 判构图是否漂亮/是否缺道具 →
  需要则回 Stage 加实体（新增局部实体 + 触发对齐）。
- 出图阶段：按 registry 首次/二次出图逻辑做外观一致性。
- 对话/音频：beats 的 dialogue + delta.mood + emotion 简报驱动 TTS/BGM。

---

## 10. 已知未决（待定，未实现）

- 「加道具能否成功」的可行性裁决（空间是否放得下、是否遮挡关键实体）应否
  由 Stage 用几何硬判，还是 LLM 软判 + 粗坐标兜底 —— 倾向后者，未定。
- 全局实体的 canonical 外观随剧情永久演变（如角色毁容）时，是否需要
  多版本 canonical（V1/V2）+ 图片历史分段 —— 倾向需要，未定。
- 光源是否升级为独立全局表（跨场景灯光风格一致）—— 倾向暂留场景局部，未定。