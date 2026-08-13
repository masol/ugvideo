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
 * Config —— 从 Artifact 派生的配置项
 *
 * 语义：一种带固定默认内容、不由任何步骤产出的交付物（如模板 / 公式清单 / 问题清单）。
 * 复用 Artifact 的一切能力（同样注册进 ArtifactCenter，kind 仍为 'artifact'），
 * 额外携带 defaultValue（完整逐字内容），以 isConfig 判别。
 */
export interface Config extends Artifact {
    isConfig: true;
    defaultValue: string;
}

/**
 * Constraint —— 验证机制
 *
 * 对 Artifact：验证其值是否有效。
 * 对 Node：判断节点执行是否正确（通过判断其输入/输出产物）。
 *
 * 注意：约束不再从人类工作流中被"提取"为独立结构——它们以自然语言形态
 * 内蕴在节点的 actionAtom 里。此类型仅作为概念模型保留，供后续编译阶段按需使用。
 */
export interface Constraint extends ExecutableConcept {
    kind: 'constraint';
}

export type FlowNodeKind = 'flow-node' | 'human';

/**
 * FlowNode
 *
 * 所有非顺序控制流（跳转、条件回退、循环）一律以自然语言保留在 actionAtom 中，
 * 由后续编译阶段从动作文本重新解析——避免在语义整理阶段过早、易错地结构化。
 * DAG 的边完全由 artifact 的 producer→consumer 依赖驱动。
 */
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
    /** 主流程标记：索引为 0 的入口文档对应图为 true，其余不设或 false */
    isMain?: boolean;
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