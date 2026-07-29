# 分镜设计（design-shots）—— 架构设计

> 「剧本 → 视频」工作流第三步。本节点的核心职责是：
> **为每个场景设计分镜序列 + 场景光照 + 逐实体素材扩写**。
>
> 上游依赖：parse-script（场景索引）+ align-entities（名称对齐后原文 + 全局实体登记册）。
> 下游消费：提示词合成节点（读分镜 + 光照 + 素材 → 生成图像/视频提示词）。

---

## 0. 一句话目标

为每个场景设计分镜序列，确定场景统一光照，为每个实体扩写详细的视觉描述，
让下游节点可以直接用这些描述生成提示词和 reference image。

---

## 1. 核心设计哲学

**过程式 > 目标式**：所有 LLM prompt 是"先做什么，再做什么"的操作步骤。

**素材叠加哲学**：
- 每个实体的视觉描述是**跨场景累积叠加**的
- 第 N 场的同一角色 = 第 N-1 场的基础描述 + 本场变化（换装/受伤/光影/姿态）
- 一致性通过"同一实体引用同一 reference image + 叠加变化描述"实现
- 本节点只负责产出描述，不负责一致性校验（那是下游 VLM 闭环的事）

**素材重要性分级**：
- 重要素材（需独立生成 reference image）：主要角色、关键道具、核心场景
- 次要素材（仅在提示词中出现，由视频模型自行生成）：路人、背景物件、氛围元素

**光照先行**：先确定场景统一光照 → 光照成为素材描述和分镜的共同约束。

---

## 2. 全局视觉准则配置项

从用户配置读取（带默认值），直接映射为固化 prompt 片段：

| 配置项 | key | 可选值 | 默认值 |
|---|---|---|---|
| 节奏基调 | `pace` | `normal` / `slow` / `fast` | `normal` |
| 画幅 | `aspectRatio` | `9:16` / `16:9` / `1:1` / `4:3` / `3:4` / `21:9` / `4:5` / `2:1` | `9:16` |
| 视觉风格 | `style` | `cinematic` / `anime` / `cg` / `live` / `watercolor` / `comic` / `pixel` / `noir` | `cinematic` |
| 受众分级 | `audience` | `g` / `pg` / `pg13` / `r` / `nc17` | `pg` |
| 色调倾向 | `colorTone` | `warm_vibrant` / `warm_muted` / `neutral` / `cool_crisp` / `cool_moody` | `neutral` |
| 运镜风格 | `cameraMovement` | `tripod` / `smooth` / `natural` / `handheld` | `smooth` |

---

## 3. 数据分表

| 表                 | KV key                                  | 作用域 | 内容                                      |
| ------------------ | --------------------------------------- | ------ | ----------------------------------------- |
| 场景意图抽象       | `#video:shots:intent_*`                 | 单场景 | 场景压缩为抽象概念表达                    |
| 分镜设计步骤 SKILL | `#video:shots:shot_skill_*`             | 单场景 | RAG/LLM 产出的分镜过程式步骤              |
| 素材设计步骤 SKILL | `#video:shots:asset_skill_*`            | 单场景 | RAG/LLM 产出的素材过程式步骤              |
| 场景分镜设计       | `#video:shots:design_*`                 | 单场景 | 分镜序列（NL）                            |
| 场景光照设计       | `#video:shots:lighting_*`               | 单场景 | 统一光照描述（光源/色温/方向/效果）       |
| 单实体素材描述     | `#video:shots:asset_<sceneId>_<entity>` | 单实体 | 独立落盘的实体视觉描述                    |
| 素材全局约束累积   | `#video:shots:asset_constraints`        | 全局   | 已确认的素材视觉描述基准                  |
| 分镜索引           | `#video:shots:idx:scenes`               | 全局   | 已完成设计的场景 id 列表                  |
| 总览               | `#video:output:shots_overview`          | 全局   | 人类可读拼接                              |

---

## 4. 处理流程

```
gate(inputs: output:stage_overview, outputs: output:shots_overview)
  → 素材全局约束初始化（从登记册提取已有外观描述）
  → pMap(scenes, designScene)  // 并发
      ├─ Pass A: 场景意图抽象
      ├─ RAG/LLM: 获取分镜 SKILL + 素材 SKILL
      ├─ Pass B: 分镜设计
      ├─ Pass C: 场景光照设计
      ├─ Pass D: 逐实体素材扩写（独立落盘）
      └─ 评审 ReAct（仅检查素材描述与已有约束的冲突）
  → 总览拼接
```

### Pass A｜场景意图抽象
- 将场景原文压缩为：核心动作 / 情绪 / 人数 / 空间类型 / 节奏 / AI 风险点
- 产出结构化查询语句供 RAG

### SKILL 获取
- RAG 检索 → 命中则直接使用
- RAG 空 → LLM 生成过程式步骤（注入全局配置）

### Pass B｜分镜设计
- 注入：固化配置 prompt + SKILL + 光照（Pass C 产出后回写，首轮无光照则 Pass B 先跑）
- 产出：分镜序列 NL

### Pass C｜场景光照设计
- 确定场景统一光源：方向 / 色温 / 强度 / 效果 / 补光
- 基于场景环境（室内/室外/时间）+ 全局色调配置
- 产出独立落盘，供 Pass D 和下游提示词使用

### Pass D｜逐实体素材扩写
- 对每个实体：
  1. 读已有约束（全局基准）
  2. 叠加本场景变化（换装/受伤/姿态/光影效果）
  3. 判断重要性（primary / secondary）
  4. 独立落盘
- 注入：场景光照 + 全局风格 + SKILL

### 评审（ReAct，最多 2 轮）
- **仅检查**：素材描述是否与全局约束中同名实体的已有描述**硬冲突**
  - 冲突 = 五官/体型/种族/物种等不可变特征矛盾
  - 非冲突 = 换装/受伤/姿态变化（这是合理的叠加）
- 打回时输出具体冲突项到日志
- 分镜设计不评审（已被 styleDirectives 强约束）

---

## 5. 素材重要性判断

| 重要性 | 标准 | 处理 |
|---|---|---|
| primary | 主要角色 / 剧情关键道具 / 核心场景 | 独立生成 reference image |
| secondary | 路人 / 背景物件 / 氛围元素 | 仅在提示词中描述，由视频模型自行生成 |

判断依据：
- character 且在 ≥2 个场景出场 → primary
- character 且仅本场出场且有台词/关键动作 → primary
- prop 且被剧情显著使用（持有/传递/特写）→ primary
- set 且为核心场景空间 → primary
- 其余 → secondary

---

## 6. 光照与素材的关系

```
场景光照（Pass C）
  ↓ 注入
素材扩写（Pass D）：每个实体的光影效果基于场景光照
  ↓ 注入
分镜（Pass B）：每个镜头的色彩光影列引用场景光照
  ↓
下游提示词合成：光照 + 素材 + 分镜 → 最终提示词