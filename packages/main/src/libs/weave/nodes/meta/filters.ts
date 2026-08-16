/**
 * weaver · meta · blueprintFilters 拼接（纯代码）
 */

import type { ArtifactLineageMap } from "../../types.js";

export function buildBlueprintFilters(
    levels: string[][],
    lineage: ArtifactLineageMap,
): { glossary: { value: string; desc: string }[] } {
    const glossary: { value: string; desc: string }[] = [];
    const seen = new Set<string>();

    for (const lv of levels) {
        for (const nodeName of lv) {
            if (seen.has(nodeName)) continue;
            seen.add(nodeName);
            glossary.push({
                value: `#${nodeName}`,
                desc: `节点「${nodeName}」的产物数据`,
            });
        }
    }

    const finalArtifacts = Object.values(lineage.byArtifact)
        .filter((l) => l.successors.length === 0)
        .map((l) => l.artifact)
        .slice(0, 10);

    for (const name of finalArtifacts) {
        if (seen.has(name)) continue;
        seen.add(name);
        glossary.push({
            value: `#${name}`,
            desc: `产物「${name}」相关数据`,
        });
    }

    return { glossary };
}