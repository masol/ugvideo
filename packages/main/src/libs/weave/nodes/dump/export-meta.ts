/**
 * weaver · dump · 导出 meta.json + type.json
 */

import { throwUnprcessable } from "$libs/utils/err.js";
import { knowledgeCenter } from "$libs/utils/kc.js";
import { dataCenter } from "$libs/utils/sys/data.js";
import { ensureFile } from "fs-extra";
import { writeFile } from "fs/promises";
import type { WeaveContext } from "../../context.js";

export async function exportMeta(ctx: WeaveContext, id: string): Promise<void> {
    const store = ctx.storage.workflow;

    const metaJsonStr = store.getMetaJson();
    const typeJsonStr = store.getTypeJson();

    if (!metaJsonStr) throwUnprcessable("[dump] 缺少 meta_json");
    if (!typeJsonStr) throwUnprcessable("[dump] 缺少 type_json");

    // const metaJson = JSON.parse(metaJsonStr);
    // const typeJson = JSON.parse(typeJsonStr);

    // 写 meta.json
    const metaPath = dataCenter.typePath(`${id}.json`);
    await ensureFile(metaPath);
    await writeFile(metaPath, metaJsonStr);

    // 写 type.json
    await knowledgeCenter.writeFile(typeJsonStr, id, "type.json");

    ctx.ctx.info(`[dump] meta.json + type.json 已导出`);
}