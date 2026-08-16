/**
 * weaver · dump · 导出所有节点的 .capa + .code
 */

import { configService } from "$libs/store/index.js";
import { throwUnprcessable } from "$libs/utils/err.js";
import { knowledgeCenter } from "$libs/utils/kc.js";
import pMap from "p-map";
import { minify } from "terser";
import type { WeaveContext } from "../../context.js";
import type { HumanNode } from "../../types.js";
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

        // 构建 .capa
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

        // 构建完整 .code（含 glossary 尾部）
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
        );

        // ctx.ctx.debug("fullcode=", fullCode)

        // terser 压缩
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