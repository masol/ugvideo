/**
 * weaver · compile · TS 伪代码一致性校验
 */

import type { FunctionPlan } from "./parse-types.js";

export interface VerificationResult {
    valid: boolean;
    feedback: string[];
}

export function verifyFunctionPlan(
    plan: FunctionPlan,
    code: string,
    declaredInputs: string[],
    _declaredOutputs: string[],
): VerificationResult {
    const feedback: string[] = [];

    // 1. 代码非空
    if (!code.trim()) {
        feedback.push("[结构校验] 伪代码为空");
        return { valid: false, feedback };
    }

    // 2. api_kind 必须明确
    if (!["code", "llm", "aigc", "human", "external"].includes(plan.apiKind)) {
        feedback.push(`[结构校验] api_kind 未明确：${plan.apiKind}`);
    }

    // 3. 声明的输入必须在代码中实际使用
    const codeWithoutComments = stripComments(code);
    for (const inp of declaredInputs) {
        if (!codeWithoutComments.includes(inp)) {
            feedback.push(`[伪代码一致性] 声明的输入 \`${inp}\` 未在伪代码中使用`);
        }
    }

    // 4. 代码必须包含 async function
    if (!/async\s+function/.test(code)) {
        feedback.push(`[伪代码一致性] 伪代码必须包含 async function 定义`);
    }

    // 5. 约束器描述非空
    for (const c of plan.constraints) {
        if (!c.description.trim()) {
            feedback.push(`[约束器校验] 约束器 ${c.id} 描述为空`);
        }
    }

    // 6. 检查控制流保留（必须有 await 或 return）
    if (!/await|return/.test(code)) {
        feedback.push(`[伪代码一致性] 伪代码缺少 await 或 return`);
    }

    // 7. 外部函数调用必须有描述
    for (const fn of plan.externalFunctions) {
        if (!fn.purpose.trim()) {
            feedback.push(`[外部函数] 外部函数 \`${fn.name}\` 缺少功能描述`);
        }
    }

    return { valid: feedback.length === 0, feedback };
}

/** 移除单行注释 */
function stripComments(code: string): string {
    return code.replace(/\/\/.*$/gm, "");
}