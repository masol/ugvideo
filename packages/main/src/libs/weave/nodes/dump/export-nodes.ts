/**
 * weaver · dump · 导出所有节点的 .capa + .code
 *
 * v3 变更：
 * - 收集主工作流的非配置输入名集合，传入 buildNodeCode 用于区分
 *   glossary.getInput（外部输入）vs glossary.get（前置产出）。
 */

import { configService } from "$libs/store/index.js";
import { throwUnprcessable } from "$libs/utils/err.js";
import { knowledgeCenter } from "$libs/utils/kc.js";
import pMap from "p-map";
import { minify } from "terser";
import type { WeaveContext } from "../../context.js";
import type { Artifact, HumanFlow, HumanNode } from "../../types.js";
import { buildNodeCode } from "./build-node-code.js";

export async function exportNodes(ctx: WeaveContext, id: string): Promise<void> {
    const store = ctx.storage.workflow;
    const safeNameMap = store.getSafeNameMap();
    if (!safeNameMap) throwUnprcessable("[dump] 缺少 safe_name_map");

    const nodeIds = store.getFunctionPlanIndex();
    if (!nodeIds || nodeIds.length === 0) {
        ctx.ctx.info("[dump] 无节点需要导出");
        return;
    }

    const concurrency = Math.max(configService().get("concurrency") || 4, 2);
    const flowInputNames = collectFlowInputNames(ctx);

    await pMap(nodeIds, async (nodeId) => {
        const selfId = safeNameMap[`node:${nodeId}`];
        if (!selfId) {
            ctx.ctx.info(`[dump] 节点「${nodeId}」无映射 id，跳过`);
            return;
        }

        const node = ctx.conceptManager.nodes.get(nodeId) as HumanNode | null;
        if (!node) {
            ctx.ctx.info(`[dump] 节点「${nodeId}」不存在，跳过`);
            return;
        }

        const plan = store.getFunctionPlan(nodeId);
        const code = store.getFunctionCode(nodeId);
        if (!plan || !code) {
            ctx.ctx.info(`[dump] 节点「${nodeId}」缺少 plan/code，跳过`);
            return;
        }

        const capa = {
            id: selfId,
            name: "#code",
            role: "",
            goal: "",
            input: node.inputs.map((name) => `#${name}`),
            output: node.outputs.map((name) => `#${name}`),
            process: "",
            negative: "",
            criteria: "",
            fewshot: [],
        };

        await knowledgeCenter.writeFile(
            JSON.stringify(capa, null, 2),
            id,
            "capa",
            `${selfId}.capa`,
        );

        const giIndex = store.getGeneratedInstructionsIndex() ?? [];
        const instructionIds = plan.instructions
            .map((inst) => `${nodeId}:${inst.id}`)
            .filter((ck) => giIndex.includes(ck));

        const fullCode = buildNodeCode(
            code,
            node,
            plan,
            instructionIds,
            safeNameMap,
            flowInputNames,
        );

        const minified = await minify(fullCode, {
            compress: { dead_code: true, unused: true },
            mangle: true,
            format: { comments: false },
            module: true,
        });

        const finalCode = minified.code ?? fullCode;

        await knowledgeCenter.writeFile(fullCode ?? finalCode, id, "capa", `${selfId}.code`);

        ctx.ctx.info(`[dump] 节点「${nodeId}」→ ${selfId.slice(0, 8)}… 已导出`);
    }, { concurrency });
}

/**
 * 收集主工作流中所有非配置的输入产物名——这些是工作流入口需要外部提供的材料，
 * 运行时应通过 glossary.getInput(...) 读取，与 type.json 中 input-manager 的 bind
 * 同源。
 */
function collectFlowInputNames(ctx: WeaveContext): Set<string> {
    const out = new Set<string>();
    const mainFlow = findMainFlow(ctx);
    if (!mainFlow) return out;

    for (const inputId of mainFlow.inputs) {
        const a = ctx.conceptManager.artifacts.get(inputId);
        const isConfig = (a as Artifact & { isConfig?: boolean })?.isConfig === true;
        if (a && isConfig) continue;
        out.add(inputId);
    }
    return out;
}

function findMainFlow(ctx: WeaveContext): HumanFlow | null {
    const flows = ctx.conceptManager.listHumanFlows();
    return flows.find((f) => f.isMain === true) ?? flows[0] ?? null;
}