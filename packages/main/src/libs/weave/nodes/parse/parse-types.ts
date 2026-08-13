/**
 * weaver · 解析阶段的结构化类型
 *
 * 变更：新增 ArtifactSemantic（交付物语义作用，供 intent 回填 + 缓存持久化）。
 * 控制流/约束以自然语言内蕴在 action 中，不再单独结构化。
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

/** 单个交付物在整个工作流中的语义作用（由专职子 LLM 分析产出） */
export interface ArtifactSemantic {
    /** 交付物名称，与 artifact/config 的 name 逐字一致 */
    name: string;
    /** 该交付物在全局工作流中承载的语义作用（不含"是某步骤输入/输出"这类连接关系） */
    role: string;
}