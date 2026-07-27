# 导演台（Director Stage）舞台抽取 —— 架构设计

> 「剧本 → 视频」工作流第二步。本节点的唯一职责是**忠实抽取**：把每个场景的
> 舞台信息（环境、实体、站位、节拍、对话、情绪）如实记录下来，供后续设计节点使用。
> 与 parse-script 同源，本质仍是**信息抽取节点**，不是世界模拟器。

---

## 0. 一句话目标

对照场景列表与全局实体表，为每个场景抽取：
- 环境（原文描写的空间与光线线索）；
- 实体清单（以原文名称为标识，忠实外观）；
- 开场站位（原文支撑的相对位置与持有关系）；
- 节拍时间线（每拍发生什么、谁在动、说了什么、什么情绪）；
- 跨场景实体身份对齐（同一个人/道具出现在哪些场景）。

**剧本原文不脱离**：没有世界模拟器，无法脱离原文，也不追求脱离。下游需要时自会回读。

---

## 1. 核心取舍：自然语言舞台，忠实抽取

早期设计想做「梦境级物理」的坐标舞台。现已放弃：

- **不做几何**。不解算坐标、不做遮挡、不摆放包围盒。站位、持有、朝向全部用
  **自然语言**表达，不受词表限制（左/右/前/后/盘绕/倚靠/跪于/悬于/持于左手…）。
- **不推断**。本节点只抄录原文写了的东西。原文没写的外观、没提的光线、
  读不出的情绪，一律填 `null`。**推断补齐交给后续专门节点**，越界只会污染数据。
- **不编号**。实体标识直接用原文称呼（如「江乘风」「石制法盆」）。同一场景出现
  多个同名实体时，用原文可辨的定语区分（「披甲士兵」「持刀士兵」）。

工程后果：删除全部坐标求解、layout-solver、stage-engine、EntityTransform、
size_class、包围盒等一切几何结构。

---

## 2. 数据分表

| 表 | KV 前缀（Storage 内部） | 作用域 | 内容 |
|---|---|---|---|
| 场景静态舞台 | `state:stage_*` | 单场景 | 环境 + 实体清单 + 开场站位（NL） |
| 节拍时间线 | `state:beats_*` | 单场景 | beat 序列（时长/概括/情绪/站位变化/个体动静） |
| 全局实体登记册 | `stage:registry:*` | 跨场景 | 规范名、类别、首次外观、出场场景列表 |
| 场景对齐映射 | `stage:align:*` | 单场景 | 本场局部名 → 全局规范名 |
| 舞台总览 | `output:stage_overview` | 全局 | 人类可读拼接 |

拆表理由：静态舞台（空间）与节拍（时间）变动原因不同，独立时效；全局身份是跨场景
属性，与场景局部信息正交；对齐映射独立落盘，避免污染抽取产物本身。

---

## 3. 全局实体登记册 + 对齐（跨场景身份）

```ts
interface GlobalEntity {
  name: string;         // 规范名 = 原文名称（同名不同实体加定语）
  kind: EntityKind;
  appearance: string;   // 首次出场时原文中的外观（对齐比对用）
  scenes: string[];     // 出场场景 id 列表（叙事顺序）
}
```

**对齐流程（Pass D，串行，按叙事顺序）**：

登记册是增长的，S004 的实体要和 S001 已入册的比对，所以对齐必须**串行**。
逐场景、逐实体：

- 名称不在登记册 → 新建 `GlobalEntity`，`scenes=[本场]`；
- 名称已在登记册 → 用 **LLM 布尔核对**判断是否同一实体：
  - 依据双方原文外观描写；**信息不足默认判为同一个（宁合勿分）**；
  - 同一个 → 把本场景追加进 `scenes[]`；
  - 名称同但外观硬冲突（老者 vs 孩童）→ 加定语另立（`名称·场景id`）。

对齐结果写 `stage:align:{scene}`（局部名→全局名），**不改动 stage 抽取产物本身**，
保持抽取结果纯净、可独立时效。

> 布尔核对**不走 safefmt**：只需从回答末行稳定读出 `SAME` / `DIFFERENT`，
> 模糊时默认 `SAME`。这就是你说的「关键信息处引入 LLM 验证」。

登记册的 `scenes[]` 正是下游「跨场景道具/人物职能与伏笔」节点的输入。

---

## 4. 场景静态舞台

```ts
interface StageEntity {
  name: string;              // 原文名称（本场唯一，同名加定语）
  kind: EntityKind;          // character | prop | set | light
  appearance: string | null; // 原文外观，无则 null
}

interface StageWorld {
  scene_id: string;
  environment: string;       // 原文环境描写
  key_light: string | null;  // 原文光线/时间线索，无则 null（不推断方向色温）
}

interface SceneStage {
  world: StageWorld;
  entities: StageEntity[];
  spatial_layout: string | null; // 开场站位 NL，无则 null
}
```

---

## 5. 节拍时间线（动态变化）

如何表达「一拍里多个实体各自在做什么」？用 `deltas` 数组，每个实体一条，
携带该实体本拍的动作类型信息：

```ts
interface BeatDelta {
  entity: string;             // 实体名（须来自本场实体清单）
  action: string | null;      // 视觉可见动作
  dialogue: string | null;    // 台词原文
  state_change: string | null;// 外观/状态增量（伤痕/沾染）
  emotion: string | null;     // 本拍情绪（TTS 语气来源）
}

interface Beat {
  index: number;
  duration_hint: string | null; // 语义时长，供运镜/音频时序参考
  summary: string;
  mood: string | null;          // 本拍整体情绪
  staging: string | null;       // 本拍站位/关系变化 NL（含移动、持有变化）
  deltas: BeatDelta[];          // 本拍有动静的实体
}
```

站位/持有/朝向变化统一进 `staging`（自然语言）；个体的动作/台词/状态/情绪进 `deltas`。
一切以原文为准，无则 `null`。

---

## 6. 多次 LLM 抽取（按 LLM 擅长拆分）

**Pass A｜静态舞台**（`entity-analyzer`）
环境 + 实体清单（名称/类别/外观）+ 开场站位。NL → safefmt。

**Pass B｜节拍时间线**（`beat-analyzer`）
复用 Pass A 实体名称（roster 注入，不新造），切 beat。NL → safefmt。
抽取后程序化校验 deltas 是否只引用已登记实体，越界仅告警。

**Pass D｜跨场景对齐**（`entity-aligner`，串行）
名称主键 + LLM 布尔核对，维护登记册与 `stage:align:*`。

流程（index.ts）：
```
gate(inputs: parse:idx:scenes, outputs: output:stage_overview)
  → pMap(scenes, buildSceneStage)   // A+B 并发，落 stage / beats
  → for scene in order: alignScene  // D 串行，建 registry + align 映射
  → overview
```

---

## 7. 与 parse-script 的衔接

- 场景索引读 `parse:idx:scenes`；原文按 `parse:scene:{id}` 的 `line_start/line_end`
  从脚本行数组切片（行号口径与 parse-script 一致）。
- `context.charactersInvolved` 作为 Pass A 抽取人物的种子。

---

## 8. 下游接线（本节点不实现，占位说明）

- **跨场景关系节点**：读 registry（`scenes[]`）+ align，遍历跨场景道具/人物，
  抽取/建立某道具承载的职能、是否需要伏笔、承载何种情绪。
- **分镜/运镜设计节点**：顺着 beats 设计运镜、是否细分镜头，并判断构图是否美观、
  是否需要补道具。
- **音频节点**：beats 的 dialogue + delta.emotion 驱动 TTS（并据此定时长），
  情绪驱动 BGM。

本节点只负责把这些下游需要的舞台信息**准确抽取并验证**，多余的不抽（YAGNI）。

---

## 9. 已知未决

- 别名对齐（不同名同实体）属推断，交后续节点，本节点不处理。
- 对齐串行且有状态，单场景上游变动后无法完美重算下游对齐（登记册增长特性）。
  当前按场景独立时效门控，接受此局限。