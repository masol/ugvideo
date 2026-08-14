/**
 * weaver · compile · 本阶段类型定义
 */

/** API 类型分类 */
export type ApiKind = "code" | "llm" | "aigc" | "human" | "external";

/** 约束器（纯自然语言描述） */
export interface Constraint {
    id: string;
    description: string;
}

/** 外部函数调用（供后续 codegen 绑定） */
export interface ExternalFunction {
    /** 函数名（中文） */
    name: string;
    /** 函数功能描述 */
    purpose: string;
    /** 函数签名（输入/输出类型） */
    signature: string;
    /** 调用示例 */
    example?: string;
}

/** 函数执行计划（宏观信息，供后续扩展使用） */
export interface FunctionPlan {
    sourceNodeId: string;
    sourceNodeName: string;
    /** 整个步骤的 api_kind */
    apiKind: ApiKind;
    /** 约束器数组 */
    constraints: Constraint[];
    /** 外部函数调用清单 */
    externalFunctions: ExternalFunction[];
    /** 代码总结（可选，用于快速理解代码意图） */
    summary?: string;
}