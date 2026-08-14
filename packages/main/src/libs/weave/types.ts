/**
 * weaver · 所有类型定义
 */

export interface OriginRef {
    sourceText: string;
    paragraphRange: [number, number];
}

export type ConceptKind = 'artifact' | 'flow-node' | 'human' | 'constraint' | 'dag';

export interface ConceptReference {
    kind: ConceptKind;
    id: string;
    name: string;
    aliases: string[];
    intent: string;
    inferred: boolean;
    originRef?: OriginRef;
    constraintIds: string[];
}

export interface ExecutableConcept extends ConceptReference {
    actionAtom: string;
    inputs: string[];
    outputs: string[];
}

/**
 * 产物的语义层级关系——所有字段可选，"不捏造值"。
 */
export interface ArtifactRelation {
    partOf?: string[];
    composedOf?: string[];
    arrayOf?: string | null;
    refinedFrom?: string[];
    derivedFrom?: string[];
}

export interface Artifact extends ConceptReference {
    kind: 'artifact';
    shape?: 'scalar' | 'array';
    semanticFields: string[];
    relations?: ArtifactRelation;
}

export interface Config extends Artifact {
    isConfig: true;
    defaultValue: string;
}

export interface Constraint extends ExecutableConcept {
    kind: 'constraint';
}

export type FlowNodeKind = 'flow-node' | 'human';

export interface FlowNode extends ExecutableConcept {
    kind: FlowNodeKind;
}

export interface HumanNode extends FlowNode {
    kind: 'human';
}

import type { DirectedGraph } from 'graphology';

export interface FlowGraph extends ExecutableConcept {
    kind: 'dag';
    g: DirectedGraph;
    isMain?: boolean;
}

export interface HumanFlow extends FlowGraph {
    isHumanWorld: true;
}

/**
 * 单个 artifact 的 lineage。
 */
export interface ArtifactLineage {
    artifact: string;
    predecessors: string[];
    successors: string[];
    producedBy: string | null;
    consumedBy: string[];
    depth: number;
}

/**
 * 全局 lineage 表。
 */
export interface ArtifactLineageMap {
    byArtifact: Record<string, ArtifactLineage>;
    finalLineage: string[];
}

// ════════════════════════════════════════════════════════════════════
// 第二阶段：Agent IR
// ════════════════════════════════════════════════════════════════════

export interface AgentIROptions {
    artifactRelations: Record<string, ArtifactRelation>;
    artifactLineage: ArtifactLineageMap;
}

// ════════════════════════════════════════════════════════════════════
// 编译产物
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

export class ConflictSignal extends Error {
    constructor(
        readonly feedback: string,
        readonly context?: Record<string, unknown>,
    ) {
        super(feedback);
        this.name = 'ConflictSignal';
    }
}