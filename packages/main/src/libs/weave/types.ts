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

/**
 * 外部输入：无上游产出、被节点消费的 artifact。
 * 本质 = artifact 指针 + 默认值（有默认值 = 配置项，无 = 运行时输入）
 * 来源：kv-store（config:* 或 prompt-once）
 * 不存储：扫描 DAG 即可构建（门控：DAG 已存在）
 */
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
// 配置
// ════════════════════════════════════════════════════════════════════

export interface WeaveConfig {
    maxReactRounds: number;
    maxPathsPerNode: number;
    skipStandardParse: boolean;
}

// ════════════════════════════════════════════════════════════════════
// 入口控制 target
// ════════════════════════════════════════════════════════════════════

export type WeaveTarget =
    | 'parse'
    | 'formalDoc'
    | 'standardDoc'
    | 'full';

export const WeaveTargetOrder: Record<WeaveTarget, number> = {
    parse: 1,
    formalDoc: 2,
    standardDoc: 3,
    full: 4,
};

export function parseWeaveTarget(raw: string | null | undefined): WeaveTarget | null {
    if (!raw) return null;
    const v = raw.trim();
    if (v in WeaveTargetOrder) return v as WeaveTarget;
    return null;
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