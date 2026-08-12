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

export interface Artifact extends ConceptReference {
    kind: 'artifact';
    shape: 'scalar' | 'array';
    semanticFields: string[];
}

/**
 * Constraint —— 验证机制
 *
 * 对 Artifact：验证其值是否有效。
 * 对 Node：判断节点执行是否正确（通过判断其输入/输出产物）。
 */
export interface Constraint extends ExecutableConcept {
    kind: 'constraint';
}

/**
 * Jumper —— 标准 DAG 之外的额外跳转
 *
 * 在某个节点退出前，额外执行一个跳转动作。
 * - internal: 跳到本图内另一节点（执行完不返回）。
 * - external: 跳到另一图（target = 目标图 id），执行完自动返回原图继续。
 *
 * target:
 *   - internal →目标节点 name（解析阶段即为 id）
 *   - external → 目标图 id
 */
export type Jumper = {
    kind: 'internal' | 'external';
    condition: string | null;
    target: string;
};

export type FlowNodeKind = 'flow-node' | 'human';

export interface FlowNode extends ExecutableConcept {
    kind: FlowNodeKind;
    jumpers: Jumper[];
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