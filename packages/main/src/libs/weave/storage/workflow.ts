/**
 * weaver · Workflow Storage（v4）
 *
 * 变更（v4）：分离 function_plan（元信息）与 function_code（TS 代码）
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

    saveAlignedStandardDoc(docIndex: number, markdown: string): void {
        this.set(`aligned_standard_doc:${docIndex}`, markdown);
    }

    getAlignedStandardDoc(docIndex: number): string | null {
        return this.get<string>(`aligned_standard_doc:${docIndex}`);
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
    // 第三阶段：Function Plan（元信息）+ Function Code（TS 代码）
    // ══════════════════════════════════════════════════════════════

    saveFunctionPlan(nodeId: string, plan: import("../nodes/compile/parse-types.js").FunctionPlan): void {
        this.set(`function_plan:${nodeId}`, plan);
    }

    getFunctionPlan(nodeId: string): import("../nodes/compile/parse-types.js").FunctionPlan | null {
        return this.get<import("../nodes/compile/parse-types.js").FunctionPlan>(`function_plan:${nodeId}`);
    }

    saveFunctionCode(nodeId: string, code: string): void {
        this.set(`function_code:${nodeId}`, code);
    }

    getFunctionCode(nodeId: string): string | null {
        return this.get<string>(`function_code:${nodeId}`);
    }

    saveFunctionPlanIndex(nodeIds: string[]): void {
        this.set("function_plan_index", nodeIds);
    }

    getFunctionPlanIndex(): string[] | null {
        return this.get<string[]>("function_plan_index");
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