/**
 * weaver · dump · 拼接节点完整可执行代码（main + glossary 调用尾部）
 */

import type { HumanNode } from "../../types.js";
import type { FunctionPlan } from "../compile/parse-types.js";

export function buildNodeCode(
    mainCode: string,
    node: HumanNode,
    plan: FunctionPlan,
    instructionCompositeKeys: string[],
    safeNameMap: Record<string, string>,
): string {
    const lines: string[] = [];

    // 主函数体
    lines.push(mainCode);
    lines.push("");
    lines.push("// ── glossary 调度 ──");
    lines.push("");

    // 将 inputs 构造之后的逻辑封装为 run 函数
    lines.push("async function run() {");
    lines.push("  // inputs 构造");
    lines.push("  const inputs = {");
    for (const name of node.inputs) {
        lines.push(`    ${JSON.stringify(name)}: glossary.get(${JSON.stringify("#" + name)}),`);
    }
    lines.push("  };");
    lines.push("");

    lines.push("  // instructions 构造");
    lines.push("  const instructions = {");
    for (const inst of plan.instructions) {
        const ck = `${node.id}:${inst.id}`;
        const mappedId = safeNameMap[`gi:${ck}`];
        if (mappedId) {
            lines.push(`    ${JSON.stringify(inst.id)}: glossary.get(${JSON.stringify(mappedId)}),`);
        }
    }
    lines.push("  };");
    lines.push("");

    lines.push("  // 调用 main");
    lines.push("  const result = await main(inputs, instructions);");
    lines.push("");

    lines.push("  // 保存结果");
    lines.push("  for (const [key, value] of Object.entries(result)) {");
    lines.push("    glossary.save('#' + key, value);");
    lines.push("  }");
    lines.push("}");
    lines.push("");

    // checkExpiry
    const inputKeys = node.inputs.map((name) => `'#${name}'`).join(", ");
    const outputKeys = node.outputs.map((name) => `'#${name}'`).join(", ");
    const resourceKeys = instructionCompositeKeys
        .map((ck) => {
            const mappedId = safeNameMap[`gi:${ck}`];
            return mappedId ? `'${mappedId}'` : null;
        })
        .filter(Boolean)
        .join(", ");

    lines.push(`if (glossary.checkExpiry({`);
    lines.push(`  inputKeys: [${inputKeys}],`);
    lines.push(`  outputKeys: [${outputKeys}],`);
    lines.push(`  resourceKeys: [${resourceKeys}]`);
    lines.push(`})) {`);
    lines.push(`  await run();`);
    lines.push(`}`);

    return lines.join("\n");
}