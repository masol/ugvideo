// nodes/build-stage/script-lines.ts
import { isIdentifiedArray } from "$libs/blueprint/blackboard/array.js";
import { getIOByKeys } from "$libs/blueprint/glossary/ioinfo.js";
import { PrjDB } from "$libs/project/controllers/drizzle/index.js";
import type { IRunnerContext } from "$types/blueprint/context.js";
import { isString } from "radashi";

/**
 * 复用 parse-script 的行号口径重建剧本行数组：
 *   scriptArray.join("\n\n") 后再 split(/\n/)，1-based 行号 = 下标 + 1。
 */
export function loadScriptLines(ctx: IRunnerContext): string[] {
    const prjdb = PrjDB.ensure(ctx.prj);
    const io = getIOByKeys(ctx, { inputs: "script", outputs: "#video:state:stages_nl" });

    const scriptArray: string[] = [];
    if (io.inputs[0] && isIdentifiedArray(io.inputs[0])) {
        io.inputs[0].forEach((item) => {
            const s = prjdb.get<string>(`script_${item.id}`);
            if (isString(s)) scriptArray.push(s);
        });
    }

    return scriptArray.join("\n\n").split(/\n/);
}

/** 取某场景的原文片段（1-based 行号，含两端） */
export function sliceScene(lines: string[], lineStart: number, lineEnd: number): string {
    const start = Math.max(1, lineStart);
    const end = Math.min(lines.length, lineEnd);
    return lines.slice(start - 1, end).join("\n");
}