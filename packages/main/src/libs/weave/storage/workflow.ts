/**
 * weaver · Workflow Storage
 */

import type { CachedWorkflow } from "../nodes/parse/extract-workflow.js";
import type { ArtifactRelation } from "../types.js";
import { BaseStorage } from "./base.js";

export class WorkflowStorage extends BaseStorage {
    protected NS = "#weave:wf:";

    saveParsedDocsIndex(docIds: string[]): void {
        this.set("parsed_docs_index", docIds);
    }

    getParsedDocsIndex(): string[] | null {
        return this.get<string[]>("parsed_docs_index");
    }

    saveStandardDoc(docIndex: number, markdown: string): void {
        this.set(`standard_doc:${docIndex}`, markdown);
    }

    getStandardDoc(docIndex: number): string | null {
        return this.get<string>(`standard_doc:${docIndex}`);
    }

    saveRepairedStandardDoc(docIndex: number, markdown: string): void {
        this.set(`repaired_standard_doc:${docIndex}`, markdown);
    }

    getRepairedStandardDoc(docIndex: number): string | null {
        return this.get<string>(`repaired_standard_doc:${docIndex}`);
    }

    saveExtractedWorkflow(docIndex: number, data: CachedWorkflow): void {
        this.set(`extracted:${docIndex}`, data);
    }

    getExtractedWorkflow(docIndex: number): CachedWorkflow | null {
        return this.get<CachedWorkflow>(`extracted:${docIndex}`);
    }

    saveStandardOutputDoc(doc: string): void {
        this.set("standard_output_doc", doc);
    }

    getStandardOutputDoc(): string | null {
        return this.get<string>("standard_output_doc");
    }

    // ══════════════════════════════════════════════════════════════
    // 冻结 artifact 名表
    // ══════════════════════════════════════════════════════════════

    saveFrozenNames(names: string[]): void {
        this.set("frozen_artifact_names", names);
    }

    getFrozenNames(): string[] | null {
        return this.get<string[]>("frozen_artifact_names");
    }

    clearFrozenNames(): void {
        this.set("frozen_artifact_names", []);
    }

    // ══════════════════════════════════════════════════════════════
    // 第二阶段：artifact 关系表 + lineage
    // ══════════════════════════════════════════════════════════════

    saveArtifactRelations(relations: Record<string, ArtifactRelation>): void {
        this.set("artifact_relations", relations);
    }

    getArtifactRelations(): Record<string, ArtifactRelation> | null {
        return this.get<Record<string, ArtifactRelation>>("artifact_relations");
    }

    saveArtifactLineage(lineage: import("../types.js").ArtifactLineageMap): void {
        this.set("artifact_lineage", lineage);
    }

    getArtifactLineage(): import("../types.js").ArtifactLineageMap | null {
        return this.get<import("../types.js").ArtifactLineageMap>("artifact_lineage");
    }

    saveLineageDoc(markdown: string): void {
        this.set("lineage_doc", markdown);
    }

    getLineageDoc(): string | null {
        return this.get<string>("lineage_doc");
    }

    saveLineageSnapshot(snapshot: import("../nodes/preprocess-artifacts/export-lineage.js").LineageSnapshot): void {
        this.set("lineage_snapshot", snapshot);
    }

    getLineageSnapshot(): import("../nodes/preprocess-artifacts/export-lineage.js").LineageSnapshot | null {
        return this.get<import("../nodes/preprocess-artifacts/export-lineage.js").LineageSnapshot>("lineage_snapshot");
    }

    // ══════════════════════════════════════════════════════════════
    // Agent IR（第三阶段）
    // ══════════════════════════════════════════════════════════════

    saveAgentIR(nodeId: string, markdown: string): void {
        this.set(`agent_ir:${nodeId}`, markdown);
    }

    getAgentIR(nodeId: string): string | null {
        return this.get<string>(`agent_ir:${nodeId}`);
    }

    saveAgentIRIndex(nodeIds: string[]): void {
        this.set("agent_ir_index", nodeIds);
    }

    getAgentIRIndex(): string[] | null {
        return this.get<string[]>("agent_ir_index");
    }

    saveResolvedIR(nodeId: string, markdown: string): void {
        this.set(`resolved_ir:${nodeId}`, markdown);
    }

    getResolvedIR(nodeId: string): string | null {
        return this.get<string>(`resolved_ir:${nodeId}`);
    }

    saveResolvedIRIndex(nodeIds: string[]): void {
        this.set("resolved_ir_index", nodeIds);
    }

    getResolvedIRIndex(): string[] | null {
        return this.get<string[]>("resolved_ir_index");
    }

    // ══════════════════════════════════════════════════════════════
    // 可选上下文
    // ══════════════════════════════════════════════════════════════

    getGoal(): string | null {
        return this.get<string>("goal");
    }

    getConstraints(): string | null {
        return this.get<string>("constraints");
    }

    getPreferences(): string | null {
        return this.get<string>("preferences");
    }
}