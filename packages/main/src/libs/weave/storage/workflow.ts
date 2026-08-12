/**
 * weaver · Workflow Storage
 *
 * 关键变更：
 * - 整体门控：parsed_docs_index（所有文档 id 的数组）
 * - 标准文档缓存：standard_doc:<doc_index>
 * - formalDoc / standardDoc 仍写 KV（它们是后续节点的产出）
 */

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

    /** 保存单个标准文档（按 index） */
    saveStandardDoc(docIndex: number, markdown: string): void {
        this.set(`standard_doc:${docIndex}`, markdown);
    }

    getStandardDoc(docIndex: number): string | null {
        return this.get<string>(`standard_doc:${docIndex}`);
    }

    /** 形式化文档（节点 ② 的产出） */
    saveFormalDocAll(doc: string): void {
        this.set("formal_doc:all", doc);
    }

    getFormalDocAll(): string | null {
        return this.get<string>("formal_doc:all");
    }

    /** 标准输出文档（节点 ③ 的产出） */
    saveStandardOutputDoc(doc: string): void {
        this.set("standard_output_doc", doc);
    }

    getStandardOutputDoc(): string | null {
        return this.get<string>("standard_output_doc");
    }
}