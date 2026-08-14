# weaver v12 ——人类工作流 →形式化 AgentFlow 编译器

> **核心改动（v11 → v12）**：
>
> 1. **第二阶段编排**：在① parse 之后，新增 ② preprocess-artifacts → ③ decompose> → ④ resolve → ⑤ dump四个节点，逐步把 HumanFlow 编译为 Resolved Agent IR。
> 2. **Artifact 关系表**：每个 artifact 增加 `relations: ArtifactRelation` 字段
>    （partOf / composedOf / arrayOf / refinedFrom），由 ② 节点整理。
> 3. **删除未实现常量**：WeaveStep.FormalDoc / StandardDoc（YAGNI）、ParseMode
>    类型与 ConfigStorage.getParseMode（无调用方）。
> 4. **MAX_PATHS_PER_NODE**：从硬编码改为通过 `ctx.storage.config.getMaxPathsPerNode()`
>    读取。

---

## 1. 总体流程

```
人写工作流文档（NL，数组）
    │
    ▼  ═══════ 第一阶段：HumanFlow 解析 ═══════
    │  ① parse（语义整理 + 结构化抽取 + DAG 校验）
    ▼
HumanFlow (主流程 + 若干子流程)
    │
    ▼  ═══════ 第二阶段：AgentFlow 编译 ═══════
    │  ② preprocess-artifacts  整理 artifact 语义关系
    │  ③ decompose            actionAtom → Agent IR（自然语言指令序列）
    │  ④ resolve              invoke →拟合现有 skill/tool
    │  ⑤ dump                 导出 Resolved Agent IR
    ▼
Resolved Agent IR（单一 markdown，下一阶段 codegen 的输入）
```

---

## 2. 核心数据结构

### 2.1 ConceptReference（同 v11，略）

### 2.2 ArtifactRelation（v12 新增）

```typescript
interface ArtifactRelation {
  /** 当前 artifact 是哪些 artifact 的组成部分（被哪些 artifact 包含） */
  partOf: string[];
  /** 当前 artifact 由哪些 artifact 拼装而成（其组成元素） */
  composedOf: string[];
  /** 若 shape='array'，元素类型对应的 artifact 名 */
  arrayOf: string | null;
  /** 由哪些 artifact 提炼而来 */
  refinedFrom: string[];
}

interface Artifact extends ConceptReference {
  kind: "artifact";
  shape: "scalar" | "array";
  semanticFields: string[];
  relations: ArtifactRelation;
}
```

### 2.3 Agent IR 指令集（v12 新增）

```
[invoke]  <verb> on `<artifact>` → `<output>` (resolved: skill:<id>)
[compose] merge `<a>` + `<b>` → `<c>`
[parallel]
[when]    `<condition>`
[goto]    <step_number>
[await]   human approval on `<artifact>`
[then]
```

---

## 3. 各节点职责

### 3.1 ① parse（同 v11，不动）

产出 `HumanFlow`（主流程标记 `isMain=true`）。

### 3.2 ② preprocess-artifacts**输入**：

- 主工作流所有 FlowNode 的 inputs/outputs/actionAtom
- 全局 FlowGraph.intent

**产出**：

- 每个 artifact.relations 原地写入
- KV: `#weave:wf:artifact_relations`

**实现**：

1. 静态推导 refinedFrom（扫描相邻节点的输入输出）
2. LLM 补全剩余关系（partOf / composedOf / arrayOf）

### 3.3 ③ decompose

**输入**（按 FlowNode 独立处理）：

- 单个 FlowNode 的 intent / inputs / outputs / actionAtom
- FlowGraph.intent（全局目标）
- 扩展输入：前置节点 outputs + 全局 inputs
- artifact_relations（针对 inputs/outputs 涉及的 artifact）

**产出**（每个 FlowNode 一份 markdown）：

- KV: `#weave:wf:agent_ir:<node_id>`
- KV: `#weave:wf:agent_ir_index`（node_id 列表）

**实现**：单 LLM 调用，instructions 固定为 DECOMPOSE_INSTRUCTIONS。

### 3.4 ④ resolve

**输入**：

- Agent IR markdown
- DecisionStorage 中的所有 skill / tool

**产出**（每个 FlowNode 一份 markdown）：

- KV: `#weave:wf:resolved_ir:<node_id>`
- KV: `#weave:wf:resolved_ir_index`

**实现**：单 LLM 调用，让模型在每个 [invoke] 行末尾追加匹配标注。

### 3.5 ⑤ dump

**输入**：主工作流所有节点的 Resolved IR**产出**：

- KV: `#weave:wf:standard_output_doc`（单一 markdown，含全部节点的 Resolved IR）

**实现**：纯字符串拼接，无 LLM。

---

## 4. 目录结构

```
packages/main/src/libs/innerflow/weaver/
  design.md
  index.ts
  context.ts
  types.ts

  concept/
    concept-manager.ts
    centers/
      artifact-center.ts
      graph-center.ts
      node-center.ts
      others-center.ts

  graph/
    gdag.ts
    graph-ops.ts
    validate.ts

  nodes/
    parse/ # ① parse
      index.ts
      ...
 preprocess-artifacts/        # ② 新增
      index.ts
    decompose/                   # ③ 新增
      index.ts
    resolve/                     # ④ 新增
      index.ts
    dump/                        # ⑤ 新增
      index.ts

  storage/
    base.ts
    concept.ts
    config.ts
    decision.ts
    vocab.ts
    workflow.ts
    index.ts
```

---

## 5. 阶段编号

```typescript
const STEP = {
  Parse: 1,
  Preprocess: 2,
  Decompose: 3,
  Resolve: 4,
  Dump: 5,
};
```

由 `target` 配置（"N/M" 形式）控制执行到哪一步。
