/**
 * weaver · 所有类型定义（v10）
 *
 * 建模地基：ConceptReference
 * 可执行概念基类：ExecutableConcept（FlowNode / Constraint / FlowGraph / Edge 都派生之）
 */

// ════════════════════════════════════════════════════════════════════
// 基础
// ════════════════════════════════════════════════════════════════════

export interface OriginRef {
    sourceText: string;
    paragraphRange: [number, number];
}

// ════════════════════════════════════════════════════════════════════
// ConceptReference —— 所有概念的地基
// ════════════════════════════════════════════════════════════════════
// ════════════════════════════════════════════════════════════════════
// ConceptReference —— 所有概念的地基
// ════════════════════════════════════════════════════════════════════
export type ConceptKind = 'artifact' | 'flow-node' | 'human' | 'constraint' | 'edge' | 'dag';
export interface ConceptReference {
    /** 联合类型判别器 */
    kind: ConceptKind;
    id: string;
    name: string;
    aliases: string[];
    intent: string;
    inferred: boolean;
    originRef?: OriginRef;
    /** 约束器 id 数组——打破循环依赖 */
    validatorIds: string[];
}

// ════════════════════════════════════════════════════════════════════
// ExecutableConcept —— 可执行概念基类
// ════════════════════════════════════════════════════════════════════

export interface ExecutableConcept extends ConceptReference {
    actionAtom: string;
    inputs: string[];
    outputs: string[];
}

// ════════════════════════════════════════════════════════════════════
// Artifact —— 数据产物
// ════════════════════════════════════════════════════════════════════

export type ArtifactShape = 'scalar' | 'array';

export interface Artifact extends ConceptReference {
    kind: 'artifact';
    shape: ArtifactShape;
    semanticFields: string[];
    dataSchema: JSONSchema | null;
}

// JSONSchema 简化定义（实际可从 zod 推导）
export interface JSONSchema {
    type: 'object' | 'array' | 'string' | 'number' | 'boolean';
    properties?: Record<string, JSONSchema>;
    items?: JSONSchema;
    required?: string[];
}

// ════════════════════════════════════════════════════════════════════
// Constraint —— 约束器（inputs 2 / outputs 1）
// ════════════════════════════════════════════════════════════════════

export type ConstraintRelation =
    | 'equals' | 'subset-of' | 'superset-of'
    | 'references' | 'freshness>=' | 'unique-by'
    | 'covers' | 'excludes';

export interface Constraint extends ExecutableConcept {
    kind: 'constraint';
    // inputs[0] = outputText 概念 id
    // inputs[1] = inputText 概念 id（可选）
    // outputs[0] = revisionHint 概念 id
    relation?: ConstraintRelation;             // 语义关系标签
}

// ════════════════════════════════════════════════════════════════════
// Edge —— 条件跳转判定器
// ════════════════════════════════════════════════════════════════════

export interface Edge extends ExecutableConcept {
    kind: 'edge';
    // inputs：上游节点的输出
    // outputs[0] = boolean 值（是否走这条边）
}

/** FlowNode 的外边——内部边或外部边 */
export type ExternalEdge =
    | {
        kind: 'internal';
        condition: string | null;              // Constraint id，null = 无条件
        target: string;                        // 目标节点 id
    }
    | {
        kind: 'external';
        condition: string | null;              // 跳转到子图的条件
        targetGraphId: string;
        targetNodeId: string;
        returnAfter: boolean;
    };

// ════════════════════════════════════════════════════════════════════
// FlowNode —— 流程节点（仅微观）
// ════════════════════════════════════════════════════════════════════

export type FlowNodeKind = 'flow-node' | 'human';

export type AlignedKind =
    | 'kv-read' | 'kv-write' | 'tool-call' | 'llm-call' | 'prompt-user';

export interface AlignedAction {
    kind: AlignedKind;
    toolId: string | null;
    signature: string;
    missingToolWarning: string | null;
}

export interface FlowNode extends ExecutableConcept {
    kind: FlowNodeKind;
    aligned: AlignedAction | null;
    /** 外边数组——内部边 + 外部边，外部边优先 */
    externalEdges: ExternalEdge[];
}

export interface HumanNode extends FlowNode {
    kind: 'human';
}

// ════════════════════════════════════════════════════════════════════
// FlowGraph —— DAG（从 ExecutableConcept 派生）
// ════════════════════════════════════════════════════════════════════

import type { DirectedGraph } from 'graphology';

export interface FlowGraph extends ExecutableConcept {
    kind: 'dag';
    /** 图底层——graphology DirectedGraph */
    g: DirectedGraph;
    /** 形式化文档（FlowGraph 的自我描述） */
    formalDoc: string;
}

export interface HumanFlow extends FlowGraph {
    isHumanWorld: true;
}

// ════════════════════════════════════════════════════════════════════
// 编译产物（不挂在 FlowGraph 上）
// ════════════════════════════════════════════════════════════════════

export type ExternalInputSource = 'prompt-once' | 'file' | 'env';

export interface ExternalInput {
    name: string;
    alias: string;
    providedBy: ExternalInputSource;
    consumedBy: string[];
    graphId: string;
}

export type InferenceKind =
    | 'added-node' | 'added-input' | 'added-output'
    | 'linked-flow' | 'added-graph' | 'added-constraint';

export interface Inference {
    kind: InferenceKind;
    target: string;
    note: string;
    nearestOriginRef: OriginRef;
}

// ════════════════════════════════════════════════════════════════════
// 决策 / KB
// ════════════════════════════════════════════════════════════════════

export type DecisionDomain =
    | 'parse'
    | 'split'
    | 'identify-concepts'
    | 'identify-constraints'
    | 'formalize'
    | 'extract-io'
    | 'cross-review'
    | 'concept-dedup'
    | 'tool-match'
    | 'align-actions'
    | 'dataflow'
    | 'parallel-continue'
    | 'skill-match'
    | 'constraint-implicit';

export interface DecisionRef {
    domain: DecisionDomain;
    entryId: string;
    score: number;
    source: 'kb' | 'llm-fallback';
    authority: 'human' | 'llm';
    version: number;
}

export interface DecisionEntry {
    id: string;
    domain: DecisionDomain;
    featureText: string;
    decision: unknown;
    authority: 'human' | 'llm';
    version: number;
    boundNodes: string[];
    supersededBy: string | null;
    createdAt: number;
    updatedAt: number;
}

// ════════════════════════════════════════════════════════════════════
// Prompt / Skill（保留供后续文章使用，本版本不展开）
// ════════════════════════════════════════════════════════════════════

export interface PromptPair {
    system: string;
    user: string;
}

export interface Skill {
    id: string;
    signature: string;
    codeTemplate: string;
    promptTemplate: PromptPair;
    authority: 'human' | 'llm';
    version: number;
}