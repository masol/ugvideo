// src/workflows/script-to-video/nodes/parse-script/line-utils.ts

/**
 * lines[i] = 第 i+1 行内容（1-based lineNo）
 *
 * 格式化行区间供 LLM 阅读：
 *   45INT. OFFICE - DAY
 *   46  林夏走进办公室
 */
export function fmtLines(lines: string[], from: number, to: number): string {
    const start = Math.max(1, from);
    const end = Math.min(lines.length, to);
    return lines.slice(start - 1, end)
        .map((c, i) => `${start + i}\t${c}`)
        .join("\n");
}

/** 取单行内容（1-based），越界返回空串 */
export function getLine(lines: string[], lineNo: number): string {
    return lines[lineNo - 1] ?? "";
}

/** 行数*/
export function totalLines(lines: string[]): number {
    return lines.length;
}