/**
 * weaver · 解析阶段的结构化类型
 */

export interface ParsedGlobalInput {
    key: string;
    hasDefault: boolean;
    defaultValue?: string;
}

export interface SourceLines {
    start: number;
    end: number;
}

export interface ParsedNode {
    order: number;
    name: string;
    intent: string;
    inputs: string[];
    outputs: string[];
    action: string;
    sourceLines: SourceLines;
}

export interface ArtifactSemantic {
    name: string;
    role: string;
}

/** preprocess 阶段冻结 artifact 名，parse 重跑时禁止模型改名 */
export interface FrozenNamesConstraint {
    /** 冻结的 artifact 名称列表 */
    names: string[];
    /** 每个名称的语义提示（帮助模型理解为何冻结这个名字） */
    hints: Record<string, string>;
}