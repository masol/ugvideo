/**
 * weaver · compile · 本阶段类型定义（v5）
 *
 * 删除：
 *   - ExternalFunction（已迁出 plan，由 prompt 文本直接表达，避免字段冗余）
 *   - lastFeedbackKinds（死字段）
 */

export type ApiKind = "code" | "llm" | "aigc" | "human" | "external";

export interface InstructionDef {
    id: string;
    content: string;
}

export type ParallelismKind = "all-parallel" | "partial" | "sequential";

export interface ParallelismHint {
    kind: ParallelismKind;
    parallelGroups: string[][];
    note: string;
}

export interface AttemptRecord {
    round: number;
    feedbacks: { kind: "structure" | "compilation" | "api" | "parallel"; msg: string }[];
}

export interface FunctionPlan {
    sourceNodeId: string;
    sourceNodeName: string;
    apiKind: ApiKind;
    language: "js";
    instructions: InstructionDef[];
    unconverged?: boolean;
    attemptHistory?: AttemptRecord[];
    parallelismHint?: ParallelismHint;
}