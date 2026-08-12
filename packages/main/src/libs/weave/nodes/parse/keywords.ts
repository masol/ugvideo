/**
 * weaver · 标准格式关键字（中英文同义）
 *
 * 使用：直接当 string[] 用。首选关键字取 [0]（中文）；别名在 matchKeyword 等
 * 遍历处统一覆盖。导出为可变 string[]，避免 `as const` 元组类型无法当 string 用。
 */

export const KW_GLOBAL_INPUTS: string[] = ["全局输入", "Global Inputs"];
export const KW_PURPOSE: string[] = ["目的", "Purpose"];
export const KW_INPUTS: string[] = ["输入", "Inputs"];
export const KW_OUTPUTS: string[] = ["输出", "Outputs"];
export const KW_ACTION: string[] = ["动作", "Action"];
export const KW_JUMPS: string[] = ["跳转", "Jumps"];

export const KW_CONDITION: string[] = ["条件", "Condition"];
export const KW_INTERNAL_TARGET: string[] = ["内部目标", "Internal Target"];
export const KW_EXTERNAL_TARGET: string[] = ["外部目标", "External Target"];