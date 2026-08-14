/**
 * weaver · node ⑤ dump
 *
 * 职责：导出主工作流的最终 Resolved Agent IR 为单一 markdown，供人类阅读
 *       与下一阶段（codegen）使用。
 *
 * 当前不做 codegen——只 dump。
 */

import { checkExpiry } from "$libs/blueprint/glossary/expiry.js";
import type { WeaveContext } from "../../context.js";
import type { HumanFlow, HumanNode } from "../../types.js";

export async function dumpWorkflow(ctx: WeaveContext): Promise<void> {
    const store = ctx.storage.workflow;

    if (!checkExpiry(ctx.ctx, {
        inputKeys: store.latestKey("resolved_ir_index"),
        outputKeys: store.latestKey("standard_output_doc"),
    })) {
        ctx.ctx.info("[dumpWorkflow] 输出仍新鲜，跳过");
        return;
    }

    const mainFlow = findMainFlow(ctx);
    if (!mainFlow) {
        ctx.ctx.notify("dump", "无主工作流，跳过");
        return;
    }

    // const nodeIds = store.getResolvedIRIndex() ?? [];
    const sections: string[] = [];

    sections.push(`# ${mainFlow.name} — Resolved Agent IR`);
    sections.push("");
    sections.push(mainFlow.intent || "（无总则）");
    sections.push("");
    sections.push("---");
    sections.push("");

    const nodes = mainFlow.g.nodes()
        .map((id) => ctx.conceptManager.nodes.get(id))
        .filter((n): n is HumanNode => n !== null);

    for (let i = 0; i < nodes.length; i++) {
        const node = nodes[i];
        const ir = store.getResolvedIR(node.id);
        sections.push(`## Step ${i + 1}: ${node.name}`);
        sections.push("");
        sections.push(ir ?? "（无 Agent IR）");
        sections.push("");
        sections.push("---");
        sections.push("");
    }

    const fullDoc = sections.join("\n");
    store.saveStandardOutputDoc(fullDoc);

    ctx.ctx.notify("dump 完成", `Resolved Agent IR 已导出 (${fullDoc.length} 字符)`);
}

function findMainFlow(ctx: WeaveContext): HumanFlow | null {
    const flows = ctx.conceptManager.listHumanFlows();
    return flows.find((f) => (f as HumanFlow).isMain === true) ?? flows[0] ?? null;
}