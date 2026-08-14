/**
 * weaver · preprocess-artifacts · 导出 markdown 血缘图 + JSON 快照
 */

import type { ArtifactLineageMap, ArtifactRelation } from "../../types.js";

export function exportLineageMarkdown(
    relations: Record<string, ArtifactRelation>,
    lineage: ArtifactLineageMap,
    flowName: string,
): string {
    const lines: string[] = [];

    lines.push(`# ${flowName} — Artifact 血缘图`);
    lines.push("");
    lines.push("---");
    lines.push("");

    lines.push(`## 主链（从最终交付物反向追溯）`);
    lines.push("");
    if (lineage.finalLineage.length > 0) {
        lines.push("```");
        lines.push(lineage.finalLineage.join(" → "));
        lines.push("```");
    } else {
        lines.push("（无终产物）");
    }
    lines.push("");

    lines.push("---");
    lines.push("");

    lines.push(`## 所有产物详情`);
    lines.push("");

    const sorted = Object.keys(lineage.byArtifact).sort(
        (a, b) => lineage.byArtifact[a].depth - lineage.byArtifact[b].depth,
    );

    for (const name of sorted) {
        const lin = lineage.byArtifact[name];
        const rel = relations[name] ?? {};

        lines.push(`### ${name}`);
        lines.push("");
        lines.push(`- **深度**: ${lin.depth}`);
        lines.push(`- **产出节点**: ${lin.producedBy ?? "（无/外部输入）"}`);
        lines.push(`- **消费节点**: ${lin.consumedBy.length > 0 ? lin.consumedBy.join("、") : "（无）"}`);
        lines.push("");

        lines.push(`#### 语义关系`);
        lines.push("");
        if (rel.partOf && rel.partOf.length > 0) {
            lines.push(`- partOf: ${rel.partOf.map((p) => `\`${p}\``).join("、")}`);
        }
        if (rel.composedOf && rel.composedOf.length > 0) {
            lines.push(`- composedOf: ${rel.composedOf.map((c) => `\`${c}\``).join("、")}`);
        }
        if (rel.arrayOf) {
            lines.push(`- arrayOf: \`${rel.arrayOf}\``);
        }
        if (rel.refinedFrom && rel.refinedFrom.length > 0) {
            lines.push(`- refinedFrom: ${rel.refinedFrom.map((r) => `\`${r}\``).join("、")}`);
        }
        if (rel.derivedFrom && rel.derivedFrom.length > 0) {
            lines.push(`- derivedFrom: ${rel.derivedFrom.map((d) => `\`${d}\``).join("、")}`);
        }
        lines.push("");

        lines.push(`#### 血缘`);
        lines.push("");
        lines.push(`- 前驱: ${lin.predecessors.length > 0 ? lin.predecessors.map((p) => `\`${p}\``).join("、") : "（根产物）"}`);
        lines.push(`- 后继: ${lin.successors.length > 0 ? lin.successors.map((s) => `\`${s}\``).join("、") : "（终产物）"}`);
        lines.push("");
        lines.push("---");
        lines.push("");
    }

    return lines.join("\n");
}

export interface LineageSnapshot {
    relations: Record<string, ArtifactRelation>;
    lineage: ArtifactLineageMap;
    flowName: string;
}

export function exportLineageJSON(
    relations: Record<string, ArtifactRelation>,
    lineage: ArtifactLineageMap,
    flowName: string,
): LineageSnapshot {
    return { relations, lineage, flowName };
}