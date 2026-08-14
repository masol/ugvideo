/**
 * weaver · compile · FunctionPlan + Code → markdown（内存渲染，供校验使用）
 */

import type { FunctionPlan } from "./parse-types.js";

export function renderPlanMarkdown(plan: FunctionPlan, code: string): string {
    const lines: string[] = [];

    lines.push(`# Execution Plan for ${plan.sourceNodeName}`);
    lines.push("");

    lines.push(`## api_kind`);
    lines.push(plan.apiKind);
    lines.push("");

    if (plan.summary) {
        lines.push(`## Summary`);
        lines.push(plan.summary);
        lines.push("");
    }

    lines.push("## Pseudocode");
    lines.push("");
    lines.push("```typescript");
    lines.push(code);
    lines.push("```");
    lines.push("");

    if (plan.constraints.length > 0) {
        lines.push("## Constraints");
        lines.push("");
        for (const c of plan.constraints) {
            lines.push(`- ${c.id}: ${c.description}`);
        }
        lines.push("");
    }

    if (plan.externalFunctions.length > 0) {
        lines.push("## External Functions");
        lines.push("");
        for (const fn of plan.externalFunctions) {
            lines.push(`- \`${fn.name}\`: ${fn.purpose || "（待补充功能描述）"}`);
        }
        lines.push("");
    }

    return lines.join("\n");
}