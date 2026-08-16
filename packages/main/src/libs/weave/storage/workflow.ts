/**
 * weaver · Workflow Storage（v8）
 *
 * 变更（v8）：新增 meta 阶段的存储方法。
 */

import type { CachedWorkflow } from "../nodes/parse/extract-workflow.js";
import type { ArtifactRelation } from "../types.js";
import { BaseStorage } from "./base.js";

type CachedWorkflowAny = CachedWorkflow;
type ArtifactLineageMapAny = import("../types.js").ArtifactLineageMap;
type FunctionPlanAny = import("../nodes/compile/parse-types.js").FunctionPlan;
type LineageSnapshotAny = import("../nodes/preprocess-artifacts/export-lineage.js").LineageSnapshot;

export class WorkflowStorage extends BaseStorage {
    protected NS = "#weave:wf:";

    // ════════════════════════════════════════════════════════════════
    // 解析阶段
    // ════════════════════════════════════════════════════════════════

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

    saveExtractedWorkflow(docIndex: number, data: CachedWorkflowAny): void {
        this.set(`extracted:${docIndex}`, data);
    }
    getExtractedWorkflow(docIndex: number): CachedWorkflowAny | null {
        return this.get<CachedWorkflowAny>(`extracted:${docIndex}`);
    }

    saveStandardOutputDoc(doc: string): void {
        this.set("standard_output_doc", doc);
    }
    getStandardOutputDoc(): string | null {
        return this.get<string>("standard_output_doc");
    }

    // frozen names

    saveFrozenNames(names: string[]): void {
        this.set("frozen_artifact_names", names);
    }
    getFrozenNames(): string[] | null {
        return this.get<string[]>("frozen_artifact_names");
    }
    clearFrozenNames(): void {
        this.set("frozen_artifact_names", []);
    }

    // ════════════════════════════════════════════════════════════════
    // preprocess 阶段
    // ════════════════════════════════════════════════════════════════

    saveArtifactRelations(relations: Record<string, ArtifactRelation>): void {
        this.set("artifact_relations", relations);
    }
    getArtifactRelations(): Record<string, ArtifactRelation> | null {
        return this.get<Record<string, ArtifactRelation>>("artifact_relations");
    }

    saveArtifactLineage(lineage: ArtifactLineageMapAny): void {
        this.set("artifact_lineage", lineage);
    }
    getArtifactLineage(): ArtifactLineageMapAny | null {
        return this.get<ArtifactLineageMapAny>("artifact_lineage");
    }

    saveLineageDoc(markdown: string): void {
        this.set("lineage_doc", markdown);
    }
    getLineageDoc(): string | null {
        return this.get<string>("lineage_doc");
    }

    saveLineageSnapshot(snapshot: LineageSnapshotAny): void {
        this.set("lineage_snapshot", snapshot);
    }
    getLineageSnapshot(): LineageSnapshotAny | null {
        return this.get<LineageSnapshotAny>("lineage_snapshot");
    }

    // ════════════════════════════════════════════════════════════════
    // compile 阶段
    // ════════════════════════════════════════════════════════════════

    saveFunctionPlan(nodeId: string, plan: FunctionPlanAny): void {
        this.set(`function_plan:${nodeId}`, plan);
    }
    getFunctionPlan(nodeId: string): FunctionPlanAny | null {
        return this.get<FunctionPlanAny>(`function_plan:${nodeId}`);
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

    // ════════════════════════════════════════════════════════════════
    // generate-instructions 阶段
    // ════════════════════════════════════════════════════════════════

    saveGeneratedInstruction(compositeKey: string, content: string): void {
        this.set(`gi:${compositeKey}`, content);
    }
    getGeneratedInstruction(compositeKey: string): string | null {
        return this.get<string>(`gi:${compositeKey}`);
    }

    saveGeneratedInstructionsIndex(compositeKeys: string[]): void {
        this.set("gi_index", compositeKeys);
    }
    getGeneratedInstructionsIndex(): string[] | null {
        return this.get<string[]>("gi_index");
    }

    // ════════════════════════════════════════════════════════════════
    // meta 阶段
    // ════════════════════════════════════════════════════════════════

    saveMetaJson(text: string): void {
        this.set("meta_json", text);
    }
    getMetaJson(): string | null {
        return this.get<string>("meta_json");
    }

    saveTypeJson(text: string): void {
        this.set("type_json", text);
    }
    getTypeJson(): string | null {
        return this.get<string>("type_json");
    }

    saveSafeNameMap(map: Record<string, string>): void {
        this.set("safe_name_map", map);
    }
    getSafeNameMap(): Record<string, string> | null {
        return this.get<Record<string, string>>("safe_name_map");
    }

    saveStableMetaId(id: string): void {
        this.set("stable_meta_id", id);
    }
    getStableMetaId(): string | null {
        return this.get<string>("stable_meta_id");
    }

    saveIconCache(cache: Record<string, string>): void {
        this.set("icon_cache", cache);
    }
    getIconCache(): Record<string, string> | null {
        return this.get<Record<string, string>>("icon_cache");
    }

    // ════════════════════════════════════════════════════════════════
    // 可选上下文
    // ════════════════════════════════════════════════════════════════

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