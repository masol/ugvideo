/**
 * weaver · dump · 导出所有 generated instructions 为资源文件
 */

import { configService } from "$libs/store/index.js";
import { knowledgeCenter } from "$libs/utils/kc.js";
import pMap from "p-map";
import type { WeaveContext } from "../../context.js";

export async function exportResources(ctx: WeaveContext, id: string): Promise<void> {
    const store = ctx.storage.workflow;
    const safeNameMap = store.getSafeNameMap();
    if (!safeNameMap) {
        ctx.ctx.info("[dump] 缺少 safe_name_map，跳过资源导出");
        return;
    }

    const giIndex = store.getGeneratedInstructionsIndex();
    if (!giIndex || giIndex.length === 0) {
        ctx.ctx.info("[dump] 无 generated instructions，跳过资源导出");
        return;
    }

    const concurrency = Math.max(configService().get("concurrency") || 4, 2);

    await pMap(giIndex, async (compositeKey) => {
        const selfId = safeNameMap[`gi:${compositeKey}`];
        if (!selfId) {
            ctx.ctx.info(`[dump] instruction「${compositeKey}」无映射 id，跳过`);
            return;
        }

        const content = store.getGeneratedInstruction(compositeKey);
        if (!content) {
            ctx.ctx.info(`[dump] instruction「${compositeKey}」内容为空，跳过`);
            return;
        }

        await knowledgeCenter.writeFile(content, id, "res", `${selfId}.kv`);
    }, { concurrency });

    ctx.ctx.info(`[dump] ${giIndex.length} 个 instruction 资源已导出`);
}