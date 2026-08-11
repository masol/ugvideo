# weaver v10 —— 人类工作流 → 形式化 HumanFlow 编译器（最终设计）

> **核心改动**：
>
> 1. `FlowGraph extends ExecutableConcept`（与 FlowNode / Constraint / Edge 平权）。
> 2. 删除 `SequenceFlow / Gateway / SubProcessRef / ExternalInput / inferences`——全部由边（Edge）+ 全局表承担。
> 3. 引入 `Edge extends ExecutableConcept`——边是条件跳转判定器。
> 4. `FlowNode.externalEdges: ExternalEdge[]`——内部边 + 外部边联合类型，外部边优先。
> 5. 总体流程：外层（数组并行）→ 中层（单工作流细化，①~⑦ 顺序，失败回 ①）。

---

## 1. 总体流程（重新设计）

```
人写工作流文档（NL，数组）
    │
    ▼  ═══════ 外层 reAct：并行分析所有工作流 ═══════
    │       │                                       │
    │       │ 失败 → 中层 ① 重新提取（带反馈）       │
    │       ▼                                       │
    │  ┌──── 中层 reAct（单工作流细化循环）────────┐ │
    │  │ ① parse-pipelines     初提取流程图         │ │
    │  │ ② split-compound-actions 逐节点多动作拆解 │ │
    │  │ ③ identify-concepts     概念识别           │ │
    │  │ ④ identify-constraints  约束识别           │ │
    │  │ ⑤ formalize             形式化（构建 g）   │ │
    │  │ ⑥ extract-io            顺拓扑序提 IO      │ │
    │  │ ⑦ validate              DAG 验证（纯代码） │ │
    │  │     ↓ 失败                                │ │
    │  │     → 带反馈回 ① 重新提取                 │ │
    │  │     ↓ 全部通过                            │ │
    │  │ ⑩ emit-formal-doc      形式化文档         │ │
    │  └────────────────────────────────────────────┘ │
    ▼
```

**关键认识**：

- **外层**：并行分析多个工作流（数组级并发）。
- **中层**：单工作流的细化循环——顺序执行 ①~⑦，**失败回 ① 重新提取**（带反馈）。
- **内层**：每个阶段的弱 LLM 任务。

---

## 2. 核心数据结构（最终版 v5）

### 2.1 ConceptReference（不变）

```typescript
interface ConceptReference {
  id: string;
  name: string;
  aliases: string[];
  intent: string;
  inferred: boolean;
  originRef?: OriginRef;
  validatorIds: string[];
}

interface OriginRef {
  sourceText: string;
  paragraphRange: [number, number];
}
```

### 2.2 ExecutableConcept（不变）

```typescript
interface ExecutableConcept extends ConceptReference {
  actionAtom: string;
  inputs: string[];
  outputs: string[];
}
```

### 2.3 Artifact（不变）

```typescript
interface Artifact extends ConceptReference {
  kind: "artifact";
  shape: "scalar" | "array";
  semanticFields: string[];
  dataSchema: JSONSchema | null;
}
```

### 2.4 Constraint（不变）

```typescript
interface Constraint extends ExecutableConcept {
  kind: "constraint";
  // inputs.length === 2，outputs.length === 1
}
```

### 2.5 Edge —— 条件跳转判定器（新增）

```typescript
/** 边——条件跳转判定器，本身是可执行概念 */
interface Edge extends ExecutableConcept {
  kind: "edge";
  // inputs：上游节点的输出
  // outputs：布尔值（是否走这条边）
}
```

**边的两种形式（联合类型）**：

```typescript
/** FlowNode 的外边——内部边或外部边 */
type ExternalEdge =
  | {
      kind: "internal";
      condition: string | null; // Constraint id，null = 无条件跳转
      target: string; // 目标节点 id
    }
  | {
      kind: "external";
      condition: string | null; // 跳转到子图的条件
      targetGraphId: string; // 目标 DAG id
      targetNodeId: string; // 目标节点 id
      returnAfter: boolean; // 子图执行完是否返回
    };
```

**优先级**：外部边 > 内部边。判定顺序：先看是否跳转到子图，若跳则执行子图并返回，再继续内部边。

### 2.6 FlowNode（更新）

```typescript
interface FlowNode extends ExecutableConcept {
  kind: "flow-node" | "human";
  aligned: AlignedAction | null;
  /** 外边数组——内部边 + 外部边，外部边优先 */
  externalEdges: ExternalEdge[];
}

interface HumanNode extends FlowNode {
  kind: "human";
}
```

**关键改动**：

- **删除** `parentGraphId`（从图反查）。
- **删除** `inputs / outputs` 的间接引用——直接 `string[]`。
- **新增** `externalEdges: ExternalEdge[]`——取代 SequenceFlow / SubProcessRef。

### 2.7 FlowGraph —— 从 ExecutableConcept 派生

```typescript
interface FlowGraph extends ExecutableConcept {
  kind: "dag";
  /** 图底层——graphology DirectedGraph */
  g: DirectedGraph;
  /** g 的 node attrs = { nodeId: string }（字符串引用） */
  /** g 的 edge attrs = { edgeId: string }（字符串引用，指向 Edge 概念） */
  /** 形式化文档（FlowGraph 的自我描述） */
  formalDoc: string;
}
```

**关键改动**：

- **从 `ExecutableConcept` 派生**——与 FlowNode / Constraint / Edge 平权。
- **删除** `externalInputs / inferences / getFlows() / getGateways() / getSubProcessRefs() / topoOrder() / criticalNodes()`。
  - `externalInputs` → 全局表（见 §2.9）。
  - `inferences` → 全局表（见 §2.9）。
  - `getFlows() / getGateways() / getSubProcessRefs()` → 不需要了，由边（Edge）+ 节点（FlowNode.externalEdges）承担。
  - `topoOrder() / criticalNodes()` → 保留为 `graph-ops.ts` 的纯函数，由调用方按需使用。

### 2.8 HumanFlow（不变）

```typescript
interface HumanFlow extends FlowGraph {
  kind: "dag";
  isHumanWorld: true;
}
```

### 2.9 全局概念表 + 编译产物表

```typescript
class ConceptTable {
  private concepts: Map<string, ConceptReference>;

  register(concept: ConceptReference): void;
  get(id: string): ConceptReference | null;
  getMany(ids: string[]): ConceptReference[];
  getByName(name: string): ConceptReference | null;
  getValidators(conceptId: string): Constraint[];
  list(kind?: string): ConceptReference[];
  deduplicate(concepts: ConceptReference[]): ConceptReference[];
  getGraphsContaining(nodeId: string): FlowGraph[];
}

class CompiledProducts {
  /** 外部输入表（图级，编译产物） */
  externalInputs: Map<string, ExternalInput[]>;
  /** 编译器补全记录 */
  inferences: Inference[];
}

interface ExternalInput {
  name: string;
  alias: string;
  providedBy: "prompt-once" | "file" | "env";
  consumedBy: string[];
  graphId: string; // 所属图
}

interface Inference {
  kind: "added-node" | "added-input" | "added-output" | "linked-flow" | "added-graph" | "added-constraint";
  target: string;
  note: string;
  nearestOriginRef: OriginRef;
}
```

### 2.10 决策 / 工具（不变）

```typescript
interface AlignedAction {
  kind: "kv-read" | "kv-write" | "tool-call" | "llm-call" | "prompt-user";
  toolId: string | null;
  signature: string;
  missingToolWarning: string | null;
}

interface DecisionEntry {
  id: string;
  domain: string;
  featureText: string;
  decision: unknown;
  authority: "human" | "llm";
  version: number;
  boundNodes: string[];
  supersededBy: string | null;
}
```

---

## 3. 三层 reAct 详细设计（重新组织）

### 3.1 外层 reAct（并行分析所有工作流）

```typescript
class OuterReactLoop {
  async run(humanFlows: HumanFlow[], feedback?: string): Promise<HumanFlow[]> {
    // 并行分析所有工作流
    const results = await Promise.all(humanFlows.map((flow) => midLayer.run(flow, feedback)));

    // 校验跨工作流索引一致性
    const errors = this.validateCrossGraph(results);
    if (errors.length === 0) return results;

    // 失败 → 带反馈回到中层（每张图都重新走中层）
    return this.run(results, errors.join("\n"));
  }

  private validateCrossGraph(flows: HumanFlow[]): string[] {
    // 子流程跨图引用是否合法
    // 工作流索引是否唯一
    // 跨图 artifact 引用是否归一
    return errors;
  }
}
```

### 3.2 中层 reAct（单工作流细化循环）

```typescript
class MidLayerReact {
  async run(humanFlow: HumanFlow, feedback?: string): Promise<HumanFlow> {
    for (let round = 1; round <= MAX_ROUNDS; round++) {
      // ① parse-pipelines（初提取流程图，带反馈）
      const parseResult = await parse.run(humanFlow, feedback);
      if (!parseResult.ok) continue;

      // ② split-compound-actions（逐节点多动作拆解）
      const splitResult = await split.run(humanFlow);
      if (!splitResult.ok) continue;

      // ③ identify-concepts（概念识别）
      const conceptResult = await identifyConcepts.run(humanFlow);
      if (!conceptResult.ok) continue;

      // ④ identify-constraints（约束识别）
      const constraintResult = await identifyConstraints.run(humanFlow);
      if (!constraintResult.ok) continue;

      // ⑤ formalize（构建 g）
      const formalizeResult = await formalize.run(humanFlow);
      if (!formalizeResult.ok) continue;

      // ⑥ extract-io（顺拓扑序提 IO）
      const ioResult = await extractIO.run(humanFlow);
      if (!ioResult.ok) continue;

      // ⑦ validate（DAG 验证，纯代码）
      const validationErrors = validate.run(humanFlow);
      if (validationErrors.length === 0) {
        return humanFlow; // 全部通过
      }

      // 失败 → 带反馈回 ① 重新提取
      feedback = validationErrors.join("\n");
    }
    throw new Error(`[mid-react] ${MAX_ROUNDS} 轮未收敛`);
  }
}
```

**关键改动**：

- **顺序执行 ①~⑦**——不是嵌套并行 reAct。
- **失败回 ① 重新提取**——带反馈。
- **去掉"概念层/结构层"二分**——概念识别 + 约束识别 + 形式化 + 提 IO + 验证是顺序细化过程。

### 3.3 内层（单 LLM 任务）

每个阶段的弱 LLM 任务，最小化上下文。

---

## 4. KB / 决策库（不变）

- domains：`parse / split / identify-concepts / identify-constraints / formalize / extract-io`。

---

## 5. 用户层接口（不变）

- 入口：工作流文档数组 + 外部输入。
- 出口：成功（HumanFlow[] + 形式化文档）/ 校验失败 / 工具缺失 / reAct 超轮。

---

## 6. 完整的目录结构

```
packages/main/src/libs/innerflow/weaver/
  design.md
  CONVENTIONS.md
  index.ts

  shared/
    storage.ts                    # WeaveStorage
    types.ts                      # ConceptReference / ExecutableConcept
                                   # / Artifact / FlowNode / FlowGraph / Constraint
                                   # / Edge / ExternalEdge / HumanNode / HumanFlow
                                   # / AlignedAction / DecisionEntry
    context/
      weave-context.ts

    concept/
      concept-table.ts            # ConceptTable
      compiled-products.ts        # CompiledProducts（externalInputs / inferences）
      kb.ts

    decision/
      decide.ts
      decision-kb.ts
      decision-fn.ts
      features.ts
      domains.ts

    graph/
      gdag.ts                     # graphology 封装
      graph-ops.ts                # 纯图算法（topoOrder / criticalNodes 等）
      validate.ts                 # DAG 验证

    humanworld/                   # ① ~ ⑩
      parse.ts                    # ① 初提取流程图
      split-actions.ts            # ② 多动作拆解
      identify-concepts.ts        # ③ 概念识别
      identify-constraints.ts     # ④ 约束识别
      formalize.ts                # ⑤ 构建 g
      extract-io.ts               # ⑥ 顺拓扑序提 IO
      validate.ts                 # ⑦ DAG 验证
      emit-formal-doc.ts          # ⑩ 形式化文档
      react/
        outer.ts                  # 外层：并行分析所有工作流
        mid.ts                    # 中层：单工作流细化循环（①~⑦）

  workflows/
    compile/index.ts
    sync/index.ts
```

**关键改动**：

- **删除** `humanworld/react/concept-layer.ts` 和 `humanworld/react/structure-layer.ts`（不再嵌套并行）。
- **删除** `humanworld/react/cross-review.ts`（不再单独成文件）。
- **新增** `humanworld/react/mid.ts`——中层细化循环。
- **新增** `shared/concept/compiled-products.ts`——编译产物表（externalInputs / inferences）。
- **新增** `shared/humanworld/` 下的具体阶段文件（parse / split / identify-concepts / identify-constraints / formalize / extract-io / validate）作为中层调用的具体实现。

---

## 7. 与 v9 的差异

| 维度                                                         | v9                              | v10                                                                   |
| ------------------------------------------------------------ | ------------------------------- | --------------------------------------------------------------------- |
| `FlowGraph` 基类                                             | `extends ConceptReference`      | **`extends ExecutableConcept`**——与 FlowNode / Constraint / Edge 平权 |
| `FlowGraph.externalInputs / inferences`                      | 挂在 FlowGraph 上               | **删除**——移到全局 `CompiledProducts`                                 |
| `SequenceFlow / Gateway / SubProcessRef`                     | 存在                            | **删除**——由 Edge（边概念）+ FlowNode.externalEdges 承担              |
| `ExternalInput`                                              | FlowGraph 字段                  | **移到全局表**（`CompiledProducts.externalInputs`）                   |
| 边（Edge）                                                   | 不存在                          | **新增**——`Edge extends ExecutableConcept`，是条件跳转判定器          |
| `FlowNode.externalEdges`                                     | 不存在                          | **新增**——`ExternalEdge[]`（内部边 + 外部边联合类型，外部边优先）     |
| `FlowGraph.getFlows() / getGateways() / getSubProcessRefs()` | 查询接口                        | **删除**——由 Edge + externalEdges 承担                                |
| `FlowGraph.topoOrder() / criticalNodes()`                    | FlowGraph 方法                  | **移到 `graph-ops.ts`**——纯函数                                       |
| 总体流程                                                     | 外层/中层（嵌套并行）           | **外层（并行）→ 中层（顺序细化，失败回 ①）**                          |
| 概念层 reAct                                                 | 嵌套并行（概念识别 + 约束识别） | **中层内顺序步骤**（③ 概念识别 → ④ 约束识别）                         |
| 失败回溯方向                                                 | 概念层失败回灌 / 结构层失败上溯 | **统一回 ① 重新提取**（带反馈）                                       |

---

## 8. 仍在视野中的事项（推荐）

- **Edge 的 inputs / outputs 形式**：当前 `Edge.outputs = [booleanValueId]`——布尔值也需要作为概念表中的一个 Artifact 注册。是否值得为布尔值单独建一个 `BooleanArtifact` 子类？推荐建。
- **网关节点的实现**：当前 FlowNode.externalEdges 已能表达多出边（含条件），不需要单独的 Gateway 节点。若未来出现"复杂分支聚合"需求，可让 FlowNode 的 `actionAtom` 表达"根据 X 路由"。
- **跨图引用的校验**：当前 `validate.ts` 需检查 `ExternalEdge.targetGraphId` 是否存在、`targetNodeId` 是否在该图中存在。
- **顶层 reAct 的反馈机制**：失败回 ① 重新提取时，反馈应包含"哪张图、哪个节点、什么问题"，让 ① 能针对性调整。
- **下一篇文章**：weaver v11——HumanFlow → AgentFlow → 代码（引入 AgentNode / Skill / 代码生成）。

---

## 9. 整体观感

- **一个基类统一所有可执行概念**：`ExecutableConcept`。FlowNode / Constraint / FlowGraph / Edge 都派生之——都有 `actionAtom / inputs / outputs`，都可被编译为代码。
- **边也是概念**：`Edge` 是条件跳转判定器。`FlowNode.externalEdges` 用联合类型表达内部边 / 外部边，外部边优先——优雅地实现"跳转子图 → 返回后继续"。
- **元信息不挂在本体上**：`externalInputs / inferences` 移到全局 `CompiledProducts`——FlowGraph 只保留自身固有属性。
- **删除冗余的 SequenceFlow / Gateway / SubProcessRef**——全部由边承担。
- **总体流程清晰**：外层并行（数组级）→ 中层顺序细化（①~⑦，失败回 ①）→ 内层单任务。不再有嵌套并行的复杂 reAct。
