# weaver v13 ——人类工作流 →形式化 AgentFlow 编译器

> **核心改动（v12 → v13）**：
>
> 1. **数据血缘新增 format 字段**：每个 artifact 增加 `format`字段，标识字符串内容的解析方式（markdown / json / plain），供后续节点选择正确的解析策略。
> 2. **Compile 节点改为多 pass架构（规划中）**：第一 pass 生成骨架代码，第二 pass 针对输入数据的格式注入解析逻辑（regex → AST → LLM 语义切分 三级 fallback），第三 pass 优化并行与 verify 收敛。
> 3. **verify 函数强制 main 外定义**：verify校验器检测 verify 函数定义是否落在 main 函数体内，是则打回重写。
> 4. **safefmt 仅用于程序化分支**：质量评审场景统一改用 `generate + __PASS__` 标记词，safefmt 只在确实需要结构化字段做 if/else 判定时才使用。
> 5. **pMap 并发数改为读 config**：未来多 pass 中如需并行 pMap，concurrency 从 config读取，不再硬编码 8。
>
> 此前版本（v11 → v12）：parse → preprocess → decompose → resolve → dump 五阶段编排。

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
    │  ② preprocess-artifacts  整理 artifact 语义关系 + format 字段
    │  ③ compile (multi-pass)   actionAtom → 可执行 JS    │  ④ dump                   导出 Resolved Agent IR
    ▼
Resolved Agent IR（单一 markdown，下一阶段 codegen 的输入）
```

---

## 2. 核心数据结构

### 2.1 ArtifactRelation（v12 继承，v13 增 format 字段）

```typescript
interface ArtifactFormat {
  /** 字符串内容的主格式 */
  kind: "markdown" | "json" | "plain";
  /** 若可形式化解析，记录 AST/JSON 的关键特征（如 markdown 的标题层级数） */
  features: string[];
  /** 若不可形式化解析，记录"语义切分"的提示（如"按主题分段"） */
  semanticHint: string;
}

interface ArtifactRelation {
  partOf: string[];
  composedOf: string[];
  arrayOf: string | null;
  refinedFrom: string[];
  format: ArtifactFormat; // ← v13 新增
}

interface Artifact extends ConceptReference {
  kind: "artifact";
  shape: "scalar" | "array";
  semanticFields: string[];
  relations: ArtifactRelation;
}
```

**format 字段的填充策略**：

- **静态判定**（优先）：正则扫描字符串内容
  - 全 JSON（`{...}` 或 `[...]` 包络，且内部无未配对引号）→ `kind: "json"`
  - 含 `## ` 或 `# ` 标题 / `|---|` 表格 / ```代码块 →`kind: "markdown"`
  - 其它 → `kind: "plain"`
- **LLM 兜底**：若静态判定置信度低（无法归入上述任一类的边界情况），调用 `extractFormatByLLM` 用弱模型判定 + 提取 semanticHint。
- **features / semanticHint**：前者记可解析特征（heading count, list count 等），后者记"若必须按语义切分，怎么切"的提示。

### 2.2 Agent IR 指令集（v12 继承，略）

---

## 3. 各节点职责

### 3.1 ① parse（同 v12）

产出 `HumanFlow`（主流程标记 `isMain=true`）。

### 3.2 ② preprocess-artifacts**输入**：

- 主工作流所有 FlowNode 的 inputs/outputs/actionAtom
- 全局 FlowGraph.intent

**产出**（v13 扩展）：

- 每个 artifact.relations 原地写入（含 format 字段）
- 每个 artifact.relations.format 由静态判定 + LLM 兜底填充
- KV: `#weave:wf:artifact_relations`

### 3.3 ③ compile（v13 重构为 multi-pass）

**输入**：

- 单个 FlowNode 的 intent / inputs / outputs / actionAtom
- 涉及的 artifact.relations.format（v13 新增——编译时据此选择解析方式）

**Pass 1：骨架生成**

- LLM 生成 reAct main + verify 框架，messages 构造用模板字符串 + `${inputKey}` 占位
- 不在此阶段要求 LLM 写解析逻辑——解析依赖 format，format 由后续 pass 注入

**Pass 2：解析逻辑注入**（v13 新增）

- 扫描 Pass 1 产出的代码，定位 `${inputKey}` 占位
- 根据 inputKey 对应 artifact 的 format.kind注入对应解析：
  - `markdown` → 注入 `unified + remarkParse` 的 AST 解析调用
  - `json` → 注入 `try { JSON.parse } catch { ... }`
  - `plain` → 注入 `llm.safefmt`语义切分调用- 若 `format.semanticHint` 非空，作为 safefmt 的 schema 描述补充

**Pass 3：并行与收敛优化**（v13 新增，可选）

- 扫描 main 函数体内顶层独立 await，标记可并行项
- 若有 verify反馈连续未变，主动增加 `verify_diversity_hint` 引导 LLM 换思路- 注入 pMap 时 concurrency 从 config 读取（不再硬编码 8）

**产出**（每个 FlowNode 一份）：

- KV: `#weave:wf:function_plan:<node_id>`
- KV: `#weave:wf:function_code:<node_id>`
- KV: `#weave:wf:function_plan_index`（node_id 列表）

### 3.4 ④ dump（同 v12）

导出主工作流所有节点的 Resolved IR 为单一 markdown。

---

## 4. 多 pass 编译的演进路径（Roadmap）

| 阶段   | 目标                          | 现状                                     |
| ------ | ----------------------------- | ---------------------------------------- |
| Pass 1 | 骨架生成（含 reAct / verify） | ✅ 已实现                                |
| Pass 2 | 解析逻辑按 format 注入        | ⏳ 规划中（需 preprocess 先输出 format） |
| Pass 3 | 并行 + verify 收敛优化        | ⏳ 规划中                                |
| Pass 4 | 错误恢复 + 局部重编译         | ❌ 未规划                                |

**Pass 2 的前置依赖**：

1. preprocess 阶段输出 artifact.relations.format（v13 已在数据结构层加好，编译端待实现填充）
2. compile 阶段识别 `${inputKey}` 占位（约定 Pass 1 用此占位符）

**Pass 2 的 fallback 三级**（DTSTTCPW）：

- Level 1：regex / split — 成本0，覆盖"格式特征明显"的输入
- Level 2：markdown AST / JSON.parse — 成本低，覆盖"格式可形式化"的输入
- Level 3：LLM 语义切分（safefmt + semanticHint）— 成本高，覆盖所有 plain 输入

---

## 5. verify校验约束（v13 收紧）

1. verify 函数必须定义在 main 外（与 main 平级）
2. verify 推荐用 `generate + __PASS__` 标记词判定（成本低、可解释）
3. safefmt 仅用于"后续代码需要程序化分支"场景（if/else / 枚举匹配）
4. messages 构造可使用模板字符串 + `${...}` 嵌入，无需为绕开正则顾虑

---

## 6. 目录结构

```
packages/main/src/libs/innerflow/weaver/
  design.md
  index.ts
  context.ts
  types.ts

  concept/
    concept-manager.ts
    centers/

  graph/
    gdag.ts
    graph-ops.ts
    validate.ts

  nodes/
    parse/
    preprocess-artifacts/
    compile/ # v13 多 pass
      index.ts                 # orchestrator
      build-function-plan.ts   # Pass 1
      inject-parsers.ts        # Pass 2（规划中）
      optimize-parallelism.ts  # Pass 3（规划中）
      verify-structure.ts # 跨 pass 校验
      parse-types.ts
      api-catalog.ts
      code-executor.ts
      react-template.ts
      render-plan-inline.ts
    dump/

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

## 7. 阶段编号

```typescript
const STEP = {
  Parse: 1,
  Preprocess: 2,
  Compile: 3,
  Codegen: 4,
  Dump: 5,
};
```

由 `target` 配置（"N/M" 形式）控制执行到哪一步。
