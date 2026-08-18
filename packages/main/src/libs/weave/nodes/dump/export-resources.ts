/**
 * weaver · dump · 导出所有 generated instructions + 配置项默认值为资源文件
 *
 * v3 变更：
 * - 同步导出配置项（Config）的 defaultValue 到 res/<id>.kv，供运行期 glossary.get(safeId) 读取；
 * - reviewer 类 instruction 在导出时自动追加 __PASS__ 输出协议尾段（运行框架统一行为）
 * - 配置项 key 取自 safeNameMap[cfg:<originalKey>]，若无映射则跳过
 */

import { configService } from "$libs/store/index.js";
import { knowledgeCenter } from "$libs/utils/kc.js";
import pMap from "p-map";
import type { WeaveContext } from "../../context.js";

/**
 * reviewer 输出协议尾段（v3 新增）。
 * 运行框架统一追加——保证所有 reviewer 的输出协议格式永远一致。
 */
const REVIEWER_OUTPUT_PROTOCOL = `
> **输出规则**：若完全满足所有评审标准，只输出"__PASS__"（不含引号的四个字符加两个下划线），不输出任何其他内容——包括"恭喜""分析如下""通过"等词语一概不输出。若不满足，详细指出问题并给出修改建议。`;

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

            // v3 新增：reviewer 类追加输出协议
            const kind = store.getInstructionClassification(compositeKey);
            const finalContent = kind === "reviewer"
                ? appendReviewerProtocolIfMissing(content)
                : content;

            await knowledgeCenter.writeFile(finalContent, id, "res", `${selfId}.kv`);
            ctx.ctx.info(
                `[dump] instruction「${compositeKey}」(kind=${kind}) → ${selfId.slice(0, 8)}… 已导出`,
            );
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
 * 对 reviewer content 追加输出协议尾段（幂等）。
 *
 * 如果 LLM 已经在 content 中写了 __PASS__ 相关输出规则（已往情况），
 * 也幂等跳过——以 content 中已经存在的引用块 + __PASS__ 关键字为准。
 *
 * 注意：v6 之后 prompt-generator.ts 已经指示 LLM 不写 __PASS__ 字面量，
 * 所以正常路径下这里都是"追加"。
 * 唯一已知已包含 __PASS__ 的情况是 prompt-generator.ts 的兜底 instruction。
 * 对兜底 instruction 的检测：如果内容末尾已经包含 "**输出规则**：若完全满足",
 * 则认为已包含输出协议，跳过追加。
 */
function appendReviewerProtocolIfMissing(content: string): string {
    if (content.includes("输出规则") && content.includes("__PASS__")) {
        return content;
    }
    return content.trimEnd() + REVIEWER_OUTPUT_PROTOCOL;
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