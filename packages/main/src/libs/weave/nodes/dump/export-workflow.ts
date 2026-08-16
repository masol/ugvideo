/**
 * weaver · dump · 导出工作流 DAG（.capa + .code + entry）
 */

import { throwUnprcessable } from "$libs/utils/err.js";
import { knowledgeCenter } from "$libs/utils/kc.js";
import { DirectedGraph } from "graphology";
import type { WeaveContext } from "../../context.js";
import type { HumanFlow } from "../../types.js";

export async function exportWorkflow(ctx: WeaveContext, id: string): Promise<void> {
    const store = ctx.storage.workflow;
    const safeNameMap = store.getSafeNameMap();
    if (!safeNameMap) throwUnprcessable("[dump] 缺少 safe_name_map");

    const mainFlow = findMainFlow(ctx);
    if (!mainFlow) {
        ctx.ctx.info("[dump] 无主工作流，跳过 DAG 导出");
        return;
    }

    // 构建映射后的 DAG
    const graph = new DirectedGraph();
    const nodeIdToSafe = new Map<string, string>();

    mainFlow.g.forEachNode((nodeId) => {
        const safeId = safeNameMap[`node:${nodeId}`];
        if (safeId) {
            nodeIdToSafe.set(nodeId, safeId);
            graph.addNode(safeId, { nodeId: safeId });
        }
    });

    mainFlow.g.forEachEdge((_edge, _attrs, source, target) => {
        const safeSource = nodeIdToSafe.get(source);
        const safeTarget = nodeIdToSafe.get(target);
        if (safeSource && safeTarget && !graph.hasEdge(safeSource, safeTarget)) {
            graph.addEdge(safeSource, safeTarget);
        }
    });

    const serializedObject = graph.export();
    const wfstr = JSON.stringify(serializedObject);

    // 工作流自身的 selfId：用 stable_meta_id 的一部分或固定 key
    // 由 safeNameMap 中没有 workflow 级映射，我们用一个确定性 id
    const wfSelfId = safeNameMap[`node:${mainFlow.id}`] ?? id;

    // 写 .code（DAG JSON）
    await knowledgeCenter.writeFile(wfstr, id, "capa", `${wfSelfId}.code`);

    // 写 .capa
    const capa = {
        id: wfSelfId,
        name: "#workflow",
        role: "",
        goal: "",
        input: [],
        output: [],
        process: "",
        negative: "",
        criteria: "",
        fewshot: [],
    };

    await knowledgeCenter.writeFile(
        JSON.stringify(capa, null, 2),
        id,
        "capa",
        `${wfSelfId}.capa`,
    );

    // 写 entry
    await knowledgeCenter.writeFile(wfSelfId, id, "entry", "entry_capa.kv");

    ctx.ctx.info(`[dump] 工作流 DAG 已导出，mainId=${wfSelfId.slice(0, 8)}…`);
}

function findMainFlow(ctx: WeaveContext): HumanFlow | null {
    const flows = ctx.conceptManager.listHumanFlows();
    return flows.find((f) => f.isMain === true) ?? flows[0] ?? null;
}