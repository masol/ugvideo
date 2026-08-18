/**
 * weaver · dump · 导出所有 generated instructions + 配置项默认值为资源文件
 *
 * v2 变更：
 * - 同步导出配置项（Config）的 defaultValue 到 res/<id>.kv，供运行期 glossary.get(safeId) 读取；
 * - 配置项 key 取自 safeNameMap[cfg:<originalKey>]，若无映射则跳过（功能不丢失，
 *   仅该配置项运行时无默认值可用——取决于上游 meta 阶段是否正确建立了 cfg 映射）。
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

    const concurrency = Math.max(configService().get("concurrency") || 4, 2);

    // ── 1. 导出 generated instructions ──
    const giIndex = store.getGeneratedInstructionsIndex();
    if (giIndex && giIndex.length > 0) {
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
    } else {
        ctx.ctx.info("[dump] 无 generated instructions，跳过 instruction 导出");
    }

    // ── 2. 导出配置项默认值 ──
    const configEntries = collectConfigDefaultValues(ctx, safeNameMap);
    if (configEntries.length > 0) {
        await pMap(configEntries, async ({ selfId, originalKey, defaultValue }) => {
            await knowledgeCenter.writeFile(defaultValue, id, "res", `${selfId}.kv`);
            ctx.ctx.info(
                `[dump] 配置项「${originalKey}」→ ${selfId.slice(0, 8)}… 已导出默认值`,
            );
        }, { concurrency });
        ctx.ctx.info(`[dump] ${configEntries.length} 个配置项默认值已导出`);
    } else {
        ctx.ctx.info("[dump] 无配置项需要导出");
    }
}

/**
 * 从 ConceptManager 收集所有 Config 的 defaultValue + 对应的 safeName id。
 */
function collectConfigDefaultValues(
    ctx: WeaveContext,
    safeNameMap: Record<string, string>,
): Array<{ selfId: string; originalKey: string; defaultValue: string }> {
    const out: Array<{ selfId: string; originalKey: string; defaultValue: string }> = [];
    for (const artifact of ctx.conceptManager.artifacts.list()) {
        if ((artifact as { isConfig?: boolean }).isConfig !== true) continue;
        const selfId = safeNameMap[`cfg:${artifact.name}`];
        if (!selfId) continue;

        const dv = (artifact as { defaultValue?: string }).defaultValue;
        if (dv == null) continue;

        out.push({ selfId, originalKey: artifact.name, defaultValue: dv });
    }
    return out;
}