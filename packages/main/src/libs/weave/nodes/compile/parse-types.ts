/**
 * weaver · compile · 本阶段类型定义
 */

/** API 类型分类 */
export type ApiKind = "code" | "llm" | "aigc" | "human" | "external";

/** 指令定义（系统提示词角色） */
export interface InstructionDef {
    /** 引用标识（代码中用 instruction: "<id>" 引用） */
    id: string;
    /** 角色定位与持续性约束 */
    content: string;
}

/** 外部函数调用（非 LLM 的外部系统） */
export interface ExternalFunction {
    /** 函数名 */
    name: string;
    /** 功能描述 */
    purpose: string;
}

/** 单轮 reAct 反馈记录 */
export interface AttemptRecord {
    round: number;
    feedbacks: { kind: "semantic" | "structure"; msg: string }[];
}

/** 函数执行计划（元信息） */
export interface FunctionPlan {
    sourceNodeId: string;
    sourceNodeName: string;
    /** 整个步骤的 api_kind */
    apiKind: ApiKind;
    /** 指令定义列表（供代码中引用） */
    instructions: InstructionDef[];
    /** 非 LLM 的外部函数调用 */
    externalFunctions: ExternalFunction[];
    /** 是否在 reAct 收敛失败后被降级落盘 */
    unconverged?: boolean;
    /** 未收敛时的反馈类型分布，便于诊断 */
    lastFeedbackKinds?: string[];
    /** 完整的 reAct 尝试历史（每轮反馈记录） */
    attemptHistory?: AttemptRecord[];
}