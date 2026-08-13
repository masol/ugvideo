/**
 * weaver · 解析阶段的结构化类型（v14）
 *
 * 抽取责任迁移：
 * - 旧 standard.ts 兼带"markup 解析 + 类型定义"，其中 markup 解析因 plainText 丢符号的
 *   latent bug 已被整体弃用。
 * - 这里只保留供 build-flow / render-standard / safefmt-normalize 复用的纯结构化类型。
 * - 抽取质量完全由 extract-workflow.ts 中 WorkflowSchema 的 zod .describe() 决定。
 */

export interface ParsedGlobalInput {
    key: string;
    hasDefault: boolean;
    defaultValue?: string;
}

export interface ParsedJumper {
    kind: "internal" | "external";
    condition: string | null;
    target: string;
}

export interface SourceLines {
    start: number;
    end: number;
}

export interface ParsedNode {
    order: number;
    name: string;
    intent: string;
    inputs: string[];
    outputs: string[];
    action: string;
    jumpers: ParsedJumper[];
    sourceLines: SourceLines;
}