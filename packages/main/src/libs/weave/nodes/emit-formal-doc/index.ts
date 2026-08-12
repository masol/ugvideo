/**
 * weaver · node ② emit-formal-doc
 */

import { checkExpiry } from "$libs/blueprint/glossary/expiry.js";
import type { WeaveContext } from "../../context.js";
import { topoOrder } from "../../graph/graph-ops.js";
import type { HumanFlow, HumanNode } from "../../types.js";

export async function emitFormalDoc(
    ctx: WeaveContext,
    flows: HumanFlow[],
): Promise<string> {
    if (flows.length === 0) {
        return "";
    }

    const outputKey = ctx.storage.workflow.latestKey("formal_doc:all");

    if (!checkExpiry(ctx.ctx, {
        inputKeys: ctx.storage.workflow.latestKey("parsed_docs_index"),
        outputKeys: outputKey,
    })) {
        const cached = ctx.storage.workflow.getFormalDocAll();
        if (cached) return cached;
    }

    const sections: string[] = [];

    sections.push("# 人类工作流形式化文档\n");
    sections.push(`## 全局目标\n${ctx.globalGoal}\n`);

    for (const flow of flows) {
        sections.push(`\n## 工作流：${flow.name}\n`);
        sections.push(`- ID：\`${flow.id}\``);
        sections.push(`- 意图：${flow.intent}`);
        sections.push(`- 节点数：${flow.g.order}`);
        sections.push(`- 边数：${flow.g.size}`);

        sections.push(`\n### 节点清单（拓扑序）\n`);
        const order = topoOrder(flow.g);
        for (const nodeId of order) {
            const node = ctx.conceptManager.get(nodeId);
            if (!node || (node.kind !== "flow-node" && node.kind !== "human")) continue;
            const humanNode = node as HumanNode;

            const inputNames = humanNode.inputs.map((id) => {
                const a = ctx.conceptManager.artifacts.get(id);
                return a ? a.name : id.slice(0, 8);
            });
            const outputNames = humanNode.outputs.map((id) => {
                const a = ctx.conceptManager.artifacts.get(id);
                return a ? a.name : id.slice(0, 8);
            });

            sections.push(`\n**${humanNode.name}** (\`${humanNode.id.slice(0, 8)}\`)`);
            sections.push(`- 意图：${humanNode.intent}`);
            sections.push(`- 动作原子：${humanNode.actionAtom}`);
            sections.push(`- 输入：${inputNames.join(", ")}`);
            sections.push(`- 输出：${outputNames.join(", ")}`);
            if (humanNode.aligned) {
                sections.push(
                    `- 执行器：${humanNode.aligned.kind}${humanNode.aligned.toolId ? `（工具：${humanNode.aligned.toolId}）` : ""}`,
                );
            }
            if (humanNode.validatorIds.length > 0) {
                sections.push(`- 约束：${humanNode.validatorIds.length} 条`);
            }
        }
    }

    const doc = sections.join("\n");
    ctx.storage.workflow.saveFormalDocAll(doc);

    ctx.ctx.notify("emit-formal-doc", `共 ${flows.length} 个工作流，总计 ${ctx.conceptCount} 个概念`);
    return doc;
}