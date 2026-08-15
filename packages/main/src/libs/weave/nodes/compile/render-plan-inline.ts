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

    if (plan.instructions.length > 0) {
        lines.push("## Instructions");
        lines.push("");
        for (const inst of plan.instructions) {
            lines.push(`- id: ${inst.id}`);
            lines.push(`  content: ${inst.content}`);
            lines.push("");
        }
    }

    lines.push("## Pseudocode");
    lines.push("");
    lines.push("```js");
    lines.push(code);
    lines.push("```");
    lines.push("");

    return lines.join("\n");
}