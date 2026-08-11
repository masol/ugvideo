/**
 * weaver · 所有类型定义（v11）
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
export type ConceptKind = 'artifact' | 'flow-node' | 'human' | 'constraint' | 'edge' | 'dag';
export interface ConceptReference {
    kind: ConceptKind;
    id: string;
    name: string;
    aliases: string[];
    intent: string;
    inferred: boolean;
    originRef?: OriginRef;
    validatorIds: string[];
}
// ════════════════════════════════════════════════════════════════════
// ExecutableConcept
// ════════════════════════════════════════════════════════════════════
export interface ExecutableConcept extends ConceptReference {
    actionAtom: string;
    inputs: string[];
    outputs: string[];
}
// ════════════════════════════════════════════════════════════════════
// Artifact
// ════════════════════════════════════════════════════════════════════
export type ArtifactShape = 'scalar' | 'array';
export interface Artifact extends ConceptReference {
    kind: 'artifact';
    shape: ArtifactShape;
    semanticFields: string[];
    dataSchema: JSONSchema | null;
}
export interface JSONSchema {
    type: 'object' | 'array' | 'string' | 'number' | 'boolean';
    properties?: Record<string, JSONSchema>;
    items?: JSONSchema;
    required?: string[];
}
// ════════════════════════════════════════════════════════════════════
// Constraint
// ════════════════════════════════════════════════════════════════════
export type ConstraintRelation =
    | 'equals' | 'subset-of' | 'superset-of'
    | 'references' | 'freshness>=' | 'unique-by'
    | 'covers' | 'excludes';
export interface Constraint extends ExecutableConcept {
    kind: 'constraint';
    relation?: ConstraintRelation;
}
// ════════════════════════════════════════════════════════════════════
// Edge / ExternalEdge
// ════════════════════════════════════════════════════════════════════
export interface Edge extends ExecutableConcept {
    kind: 'edge';
}
export type ExternalEdge =
    | {
        kind: 'internal';
        condition: string | null;
        target: string;
    }
    | {
        kind: 'external';
        condition: string | null;
        targetGraphId: string;
        targetNodeId: string;
        returnAfter: boolean;
    };
// ════════════════════════════════════════════════════════════════════
// FlowNode / HumanNode
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
    externalEdges: ExternalEdge[];
}
export interface HumanNode extends FlowNode {
    kind: 'human';
}
// ════════════════════════════════════════════════════════════════════
// FlowGraph / HumanFlow
// ════════════════════════════════════════════════════════════════════
import type { DirectedGraph } from 'graphology';
export interface FlowGraph extends ExecutableConcept {
    kind: 'dag';
    g: DirectedGraph;
    formalDoc: string;
}
export interface HumanFlow extends FlowGraph {
    isHumanWorld: true;
}
// ════════════════════════════════════════════════════════════════════
// 标准格式（v11 新增）
// ════════════════════════════════════════════════════════════════════
export interface StandardGlobalInput {
    key: string;
    hasDefault: boolean;
    defaultValue?: string;
}
export type StandardJump =
    | {
        kind: 'conditional';
        condition: string;
        targetStepOrder: number;
    }
    | {
        kind: 'fallback';
        condition: null;
        targetStepOrder: number | null;   // null = 结束
    }
    | {
        kind: 'subprocess';
        condition: string;
        targetSubFlowName: string;
        targetStepOrder: number;
        returnAfter: boolean;
    };
export interface StandardStep {
    order: number;
    name: string;
    intent: string;
    inputs: string[];
    outputs: string[];
    action: string;
    jumps: StandardJump[];
}
export interface StandardFlow {
    name: string;
    goal: string;
    globalInputs: StandardGlobalInput[];
    steps: StandardStep[];
}
export interface StandardFlowDoc {
    flows: StandardFlow[];
}
// ════════════════════════════════════════════════════════════════════
// 编译产物
// ════════════════════════════════════════════════════════════════════
export type ExternalInputSource = 'prompt-once' | 'file' | 'env' | 'config';
export interface ExternalInput {
    name: string;
    alias: string;
    providedBy: ExternalInputSource;
    hasDefault: boolean;
    defaultValue?: string;
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
    | 'skill-match';
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
// Skill
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