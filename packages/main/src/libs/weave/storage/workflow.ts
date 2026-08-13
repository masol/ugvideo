/**
 * weaver · Workflow Storage
 *
 * 变更：删除 formalDoc 存取（saveFormalDocAll/getFormalDocAll，无调用方）。
 *
 * - 结构化抽取缓存：extracted:<doc_index>（CachedWorkflow JSON，含 artifactSemantics）
 *   缓存命中时由代码确定性重建 flow，不再重跑 LLM。
 * - standard_doc:<doc_index> 保留，供人类阅读与首行图名定位。
 */

import type { CachedWorkflow } from "../nodes/parse/extract-workflow.js";
import { BaseStorage } from "./base.js";

export class WorkflowStorage extends BaseStorage {
    protected NS = "#weave:wf:";

    /** 保存所有已解析文档的 id 列表（整体门控的输出 key） */
    saveParsedDocsIndex(docIds: string[]): void {
        this.set("parsed_docs_index", docIds);
    }

    getParsedDocsIndex(): string[] | null {
        return this.get<string[]>("parsed_docs_index");
    }

    /** 保存单个标准文档（按 index，供人类阅读 / 首行图名定位） */
    saveStandardDoc(docIndex: number, markdown: string): void {
        this.set(`standard_doc:${docIndex}`, markdown);
    }

    getStandardDoc(docIndex: number): string | null {
        return this.get<string>(`standard_doc:${docIndex}`);
    }

    /** 结构化抽取缓存（缓存命中时确定性重建 flow 的来源） */
    saveExtractedWorkflow(docIndex: number, data: CachedWorkflow): void {
        this.set(`extracted:${docIndex}`, data);
    }

    getExtractedWorkflow(docIndex: number): CachedWorkflow | null {
        return this.get<CachedWorkflow>(`extracted:${docIndex}`);
    }

    /** 标准输出文档（节点 ③ 的产出） */
    saveStandardOutputDoc(doc: string): void {
        this.set("standard_output_doc", doc);
    }

    getStandardOutputDoc(): string | null {
        return this.get<string>("standard_output_doc");
    }

    // ════════════════════════════════════════════════════════════
    // 可选上下文（用户在框架层写入，本 storage 只读）
    // ════════════════════════════════════════════════════════════

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