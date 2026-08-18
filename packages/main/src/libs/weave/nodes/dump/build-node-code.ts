/**
 * weaver · dump · 拼接节点完整可执行代码（main + glossary 调用尾部）
 *
 * v3 变更：
 * - 新增 flowInputNames 参数：对工作流级输入（非配置、前置未产出的外部材料），
 *   使用 `glossary.getInput('#'+name)` 路由（与 type.json 中 input-manager 的 bind 同源）；
 *   前置步骤产出的中间产物仍走 `glossary.get('#'+name)`。
 * - 保持原 cfg 优先逻辑：配置项走 safeNameMap 中 cfg:XXX 的无 # 前缀 key。
 */

import type { HumanNode } from "../../types.js";
import type { FunctionPlan } from "../compile/parse-types.js";

export function buildNodeCode(
    mainCode: string,
    node: HumanNode,
    plan: FunctionPlan,
    instructionCompositeKeys: string[],
    safeNameMap: Record<string, string>,
    flowInputNames: ReadonlySet<string>,
): string {
    const lines: string[] = [];

    lines.push(mainCode);
    lines.push("");
    lines.push("// ── glossary 调度 ──");
    lines.push("");

    lines.push("async function run() {");
    lines.push("  // inputs 构造");
    lines.push("  // - 工作流级输入（外部材料）：glossary.getInput('#<name>')");
    lines.push("  // - 前置步骤产出（项目级 KV）：glossary.get('#<name>')");
    lines.push("  // - 配置项（Config）：glossary.get(safeNameMap 中 cfg:<name> 的值，无 # 前缀）");
    lines.push("  const inputs = {");
    for (const name of node.inputs) {
        const cfgSafeId = safeNameMap[`cfg:${name}`];
        if (cfgSafeId) {
            lines.push(`    ${JSON.stringify(name)}: glossary.get(${JSON.stringify(cfgSafeId)}),`);
        } else if (flowInputNames.has(name)) {
            lines.push(`    ${JSON.stringify(name)}: glossary.getInput(${JSON.stringify("#" + name)}),`);
        } else {
            lines.push(`    ${JSON.stringify(name)}: glossary.get(${JSON.stringify("#" + name)}),`);
        }
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
    lines.push("    glossary.set('#' + key, value);");
    lines.push("  }");
    lines.push("}");
    lines.push("");

    // checkExpiry
    const inputKeys = node.inputs
        .map((name) => {
            const cfgSafeId = safeNameMap[`cfg:${name}`];
            if (cfgSafeId) return `'${cfgSafeId}'`;
            return `'#${name}'`;
        })
        .join(", ");
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