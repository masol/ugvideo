/**
 * weaver · 所有类型定义
 */

export interface OriginRef {
    sourceText: string;
    paragraphRange: [number, number];
}

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

export interface ExecutableConcept extends ConceptReference {
    actionAtom: string;
    inputs: string[];
    outputs: string[];
}

export interface JSONSchema {
    type: 'object' | 'array' | 'string' | 'number' | 'boolean';
    properties?: Record<string, JSONSchema>;
    items?: JSONSchema;
    required?: string[];
}

export interface Artifact extends ConceptReference {
    kind: 'artifact';
    shape: 'scalar' | 'array';
    semanticFields: string[];
    dataSchema: JSONSchema | null;
}

export type ConstraintRelation =
    | 'equals' | 'subset-of' | 'superset-of'
    | 'references' | 'freshness>=' | 'unique-by'
    | 'covers' | 'excludes';

export interface Constraint extends ExecutableConcept {
    kind: 'constraint';
    relation?: ConstraintRelation;
}

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
// 编译产物
// ════════════════════════════════════════════════════════════════════

export interface ExternalInput {
    artifactId: string;
    defaultValue?: string;
}

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

// ════════════════════════════════════════════════════════════════════
// reAct 内部信号
// ════════════════════════════════════════════════════════════════════

export class ConflictSignal extends Error {
    constructor(
        readonly feedback: string,
        readonly context?: Record<string, unknown>,
    ) {
        super(feedback);
        this.name = 'ConflictSignal';
    }
}