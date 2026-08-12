# weaver v11 —— 人类工作流 → 形式化 HumanFlow 编译器

> **核心改动（v10 → v11）**：
>
> 1. 删除 `Edge` 类型——边由 `FlowNode.jumpers: Jumper[]` 表达。
> 2. `ExternalEdge` → `Jumper`，统一为 `{ kind: 'internal' | 'external', condition, target }`——但 external 额外带 `targetGraphName / targetNodeName / returnAfter`。
> 3. 删除 `ConstraintRelation`——Constraint 是验证机制，语义由 `constraintIds` 字段承载。
> 4. 删除 `Artifact.dataSchema` / `AlignedAction`——当前不需要，后续另行设计。
> 5. 删除 `AlignedAction.aligned` 字段。
> 6. 解析阶段用 `name` 作为 `id`，KV 中实际存储也是 name——避免双重 id。
> 7. 标准格式关键字提取到独立文件，支持中英文。
> 8. 跳转解析从"正则匹配整句"改为"句法驱动（条件行 + 目标行成对）"。
> 9. `validatorIds` → `constraintIds`（命名更准确）。

---

## 1. 总体流程

```
人写工作流文档（NL，数组）
    │
    ▼  ═══════ 外层 reAct：并行分析所有工作流 ═══════
    │       │
    │       │ 失败 → 中层 ① 重新提取（带反馈）
    │       ▼
    │  ┌──── 中层 reAct（单工作流细化循环）────────┐
    │  │ ① parse           初提取 HumanFlow       │
    │  │ ② emit-formal-doc 形式化文档              │
    │  │ ③ emit-standard-doc 标准输出文档          │
    │  │     ↓ 失败 │
    │  │     → 带反馈回 ① │
    │  └────────────────────────────────────────────┘
    ▼
```

---

## 2. 核心数据结构

### 2.1 ConceptReference

```typescript
interface ConceptReference {
  kind: ConceptKind;
  id: string; // 解析阶段 = name
  name: string;
  aliases: string[];
  intent: string;
  inferred: boolean;
  originRef?: OriginRef;
  constraintIds: string[];
}

interface OriginRef {
  sourceText: string;
  paragraphRange: [number, number];
}
```

### 2.2 ExecutableConcept

```typescript
interface ExecutableConcept extends ConceptReference {
  actionAtom: string;
  inputs: string[];
  outputs: string[];
}
```

### 2.3 Artifact

```typescript
interface Artifact extends ConceptReference {
  kind: "artifact";
  shape: "scalar" | "array";
  semanticFields: string[];
}
```

### 2.4 Constraint —— 验证机制

```typescript
/**
 * 对 Artifact：验证其值是否有效。
 * 对 Node：判断节点执行是否正确（通过输入/输出产物）。
 */
interface Constraint extends ExecutableConcept {
  kind: "constraint";
}
```

### 2.5 Jumper —— 标准 DAG 之外的额外跳转

```typescript
type Jumper = {
  kind: "internal" | "external";
  condition: string | null; // null = 无条件
  target: string; // internal → 节点 name；external → 目标图 id
};
```

语义：

internal：跳到本图内 target 节点，不返回原节点之后的流程。
external：跳到 target 图（执行其入口节点），执行完自动返回原图继续。

### 2.6 FlowNode

```typescript
interface FlowNode extends ExecutableConcept {
  kind: "flow-node" | "human";
  jumpers: Jumper[]; // 标准 DAG 之外的额外跳转
}

interface HumanNode extends FlowNode {
  kind: "human";
}
```

### 2.7 FlowGraph

```typescript
interface FlowGraph extends ExecutableConcept {
  kind: "dag";
  g: DirectedGraph;
  formalDoc: string; // 由 emit-formal-doc 节点写入
}

interface HumanFlow extends FlowGraph {
  isHumanWorld: true;
}
```

---

## 3. 目录结构

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
      others-center.ts # Constraint

  graph/
    gdag.ts # graphology 封装
    graph-ops.ts            # 纯图算法
    validate.ts             # DAG 验证（含路径级输入闭合性）

  nodes/
    parse/
      index.ts              # ① parse
      standard.ts           # 标准格式 → HumanFlow
      keywords.ts           # 中英文关键字
      export-standard.ts    # HumanFlow → 标准格式
      fill-gaps.ts          # LLM 缺口补全（TODO）

 emit-formal-doc/
      index.ts              # ② emit-formal-doc
 emit-standard-doc/
      index.ts              # ③ emit-standard-doc

  storage/
    base.ts
    concept.ts
    config.ts
    decision.ts
    vocab.ts
    workflow.ts
    index.ts
```
