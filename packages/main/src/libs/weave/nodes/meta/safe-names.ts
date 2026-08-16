/**
 * weaver · meta · safe-name 映射 + 配置项提取
 */

import { randomUUID } from "crypto";
import type { WorkflowStorage } from "../../storage/workflow.js";
import type { HumanFlow } from "../../types.js";
import type { ConfigItem } from "./activities.js";

export function buildSafeNameMap(
    store: WorkflowStorage,
    flow: HumanFlow,
): Record<string, string> {
    const map: Record<string, string> = {};

    flow.g.forEachNode((id) => {
        map[`node:${id}`] = randomUUID();
    });

    const giIndex = store.getGeneratedInstructionsIndex() ?? [];
    for (const ck of giIndex) {
        map[`gi:${ck}`] = randomUUID();
    }

    const stdDocs = allStandardDocs(store);
    const seenCfg = new Set<string>();
    for (const doc of stdDocs) {
        for (const m of doc.matchAll(/配置项 `([^`]+)`（默认：/g)) {
            const key = m[1].trim();
            if (seenCfg.has(key)) continue;
            seenCfg.add(key);
            map[`cfg:${key}`] = randomUUID();
        }
    }

    return map;
}

export function extractConfigItems(
    store: import("../../storage/workflow.js").WorkflowStorage,
    safeNameMap: Record<string, string>,
): ConfigItem[] {
    const items: ConfigItem[] = [];
    const seen = new Set<string>();
    const stdDocs = allStandardDocs(store);

    for (const doc of stdDocs) {
        const cfgRegex = /配置项 `([^`]+)`（默认：([\s\S]+?)）/g;
        for (const m of doc.matchAll(cfgRegex)) {
            const originalKey = m[1].trim();
            if (seen.has(originalKey)) continue;

            const safeKey = safeNameMap[`cfg:${originalKey}`];
            if (!safeKey) continue;

            seen.add(originalKey);
            items.push({
                originalKey,
                safeKey,
                label: originalKey,
                defaultValue: m[2].trim(),
            });
        }
    }

    return items;
}

function allStandardDocs(
    store: import("../../storage/workflow.js").WorkflowStorage,
): string[] {
    const out: string[] = [];
    const idx = store.getParsedDocsIndex() ?? [];
    for (const id of idx) {
        const m = id.match(/^doc_(\d+)$/);
        if (!m) continue;
        const n = parseInt(m[1], 10);
        const doc = store.getAlignedStandardDoc(n) ?? store.getStandardDoc(n);
        if (doc) out.push(doc);
    }
    return out;
}