// src/workflows/script-to-video/nodes/parse-script/chunk-splitter.ts
import type { IRunnerContext } from "$types/blueprint/context.js";
import type { Chunk } from "./types.js";

const MAX_LINES = 600;
const MAX_CHARS = 120_000;
const WINDOW = 30;

/**
 * 切分原则：
 * 1. 总行数 > MAX_LINES 或总字符数 > MAX_CHARS 时切
 * 2. 切分点：尽量在"空行"处（避免把场景切开）
 * 3. 窗口期：chunk 前后各留 WINDOW 行重叠
 */
export function splitIntoChunks(ctx: IRunnerContext, lines: string[]): Chunk[] {
    const total = lines.length;
    const totalChars = lines.reduce((acc, c) => acc + c.length + 1, 0);

    if (total <= MAX_LINES && totalChars <= MAX_CHARS) {
        return [{ chunk_id: "C0", line_start: 1, line_end: total, window_before: 0, window_after: 0 }];
    }

    const targetLines = Math.max(
        200,
        Math.min(MAX_LINES, Math.floor((MAX_CHARS / totalChars) * total))
    );

    const chunks: Chunk[] = [];
    let cursor = 0;
    let idx = 0;

    while (cursor < total) {
        let end = Math.min(cursor + targetLines, total);

        // 在 end 附近回退到最近的空行
        if (end < total) {
            let p = end;
            while (p > cursor + Math.floor(targetLines / 2) && lines[p - 1].trim() !== "") p--;
            end = p;
        }

        chunks.push({
            chunk_id: `C${idx}`,
            line_start: cursor + 1,
            line_end: end,
            window_before: cursor === 0 ? 0 : WINDOW,
            window_after: end === total ? 0 : WINDOW,
        });

        cursor = end;
        idx++;
    }

    ctx.info(`[chunk-splitter] 切分为 ${chunks.length} 个 chunk`);
    return chunks;
}

/**
 * 取 chunk 的实际内容（含窗口期）
 */
export function sliceChunk(
    lines: string[],
    chunk: Chunk
): {
    chunk_main: string[];   // 主区
    context: string[];      // 主区 + 窗口
    main_start: number;
    main_end: number;
} {
    const mainStart = Math.max(1, chunk.line_start);
    const mainEnd = Math.min(lines.length, chunk.line_end);

    const ctxStart = Math.max(1, mainStart - chunk.window_before);
    const ctxEnd = Math.min(lines.length, mainEnd + chunk.window_after);

    return {
        chunk_main: lines.slice(mainStart - 1, mainEnd),
        context: lines.slice(ctxStart - 1, ctxEnd),
        main_start: mainStart,
        main_end: mainEnd,
    };
}