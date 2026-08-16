/**
 * weaver · node ⑥ dump
 *
 * 职责：将编译产物导出为最终文件（meta.json / type.json / 节点 capa+code / DAG / 资源）。
 * 纯代码，无 LLM 调用。
 */

import { checkExpiry } from "$libs/blueprint/glossary/expiry.js";
import { configService } from "$libs/store/index.js";
import { throwUnprcessable } from "$libs/utils/err.js";
import { dataCenter } from "$libs/utils/sys/data.js";
import pMap from "p-map";
import type { WeaveContext } from "../../context.js";
import { exportMeta } from "./export-meta.js";
import { exportNodes } from "./export-nodes.js";
import { exportResources } from "./export-resources.js";
import { exportWorkflow } from "./export-workflow.js";

export async function dumpWorkflow(ctx: WeaveContext): Promise<void> {
    const store = ctx.storage.workflow;

    if (!checkExpiry(ctx.ctx, {
        inputKeys: store.latestKey("meta_json"),
        outputKeys: store.latestKey("dump_done"),
    })) {
        ctx.ctx.info("[dump] 输出仍新鲜，跳过");
        return;
    }

    const stableId = store.getStableMetaId();
    if (!stableId) {
        throwUnprcessable("无 stableId，导出失败！");
    }

    ctx.ctx.notify("dump", "开始导出编译产物");

    const concurrency = Math.max(configService().get("concurrency") || 4, 2);

    const tasks: Array<() => Promise<void>> = [
        () => exportMeta(ctx, stableId),
        () => exportNodes(ctx, stableId),
        () => exportWorkflow(ctx, stableId),
        () => exportResources(ctx, stableId),
    ];

    await pMap(tasks, (task) => task(), { concurrency });

    store.saveDumpDone("true");

    // 刷新类型缓冲。
    await dataCenter.loadTplMetas(true);
    ctx.ctx.notify("dump 完成", `stableId=${stableId.slice(0, 8)}…`);
}