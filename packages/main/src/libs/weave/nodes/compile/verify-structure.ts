/**
 * weaver · compile · 伪代码结构轻量校验
 *
 * 设计原则：伪代码不是要执行的代码，只是给 codegen 阶段的骨架。
 * 校验只关注三件事：main 存在、签名正确、代码非空。
 * 不关注内部组织方式（是否用 for 循环、是否有独立 verify 函数等）。
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
): VerificationResult {
    const feedback: string[] = [];

    // 1. 代码非空
    if (!code.trim()) {
        feedback.push(
            "[结构] 伪代码为空。请输出完整的 Pseudocode 代码块。",
        );
        return { valid: false, feedback };
    }

    // 2. 必须有 main 函数
    if (!/async\s+function\s+main\s*\(/.test(code)) {
        feedback.push(
            "[结构] 伪代码必须包含 `async function main(...)` 定义。",
        );
    }

    // 3. main 的参数类型只能是 string 或 string[]
    const mainSig = code.match(/async\s+function\s+main\s*\(([^)]*)\)/);
    if (mainSig) {
        const params = mainSig[1].trim();
        if (params && !/:\s*string(\[\])?/.test(params)) {
            feedback.push(
                "[结构] main 的参数类型只能是 `string` 或 `string[]`。",
            );
        }
    }

    // 4. main 的返回值类型只能是 Promise<string>
    const returnType = code.match(/async\s+function\s+main\s*\([^)]*\)\s*:\s*Promise<([^>]+)>/);
    if (returnType && returnType[1].trim() !== "string") {
        feedback.push(
            `[结构] main 的返回值类型必须是 Promise<string>，当前为 Promise<${returnType[1].trim()}>。`,
        );
    }

    // 5. 声明的输入必须在代码中出现（名称一致性）
    const codeClean = code.replace(/\/\/.*$/gm, "");
    for (const inp of declaredInputs) {
        if (!codeClean.includes(inp)) {
            feedback.push(
                `[结构] 声明的输入 \`${inp}\` 未在伪代码中出现，请确保参数名或变量名与其逐字一致。`,
            );
        }
    }

    // 6. api_kind 合法
    if (!["code", "llm", "aigc", "human", "external"].includes(plan.apiKind)) {
        feedback.push(
            `[结构] api_kind 值不合法：${plan.apiKind}，应为 code/llm/aigc/human/external 之一。`,
        );
    }

    return { valid: feedback.length === 0, feedback };
}