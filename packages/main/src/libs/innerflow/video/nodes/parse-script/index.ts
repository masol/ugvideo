// parse-script/index.ts
import { isIdentifiedArray } from "$libs/blueprint/blackboard/array.js";
import { getIOByKeys } from "$libs/blueprint/glossary/ioinfo.js";
import { throwPrecondition } from "$libs/utils/err.js";
import type { IRunnerContext } from "$types/blueprint/context.js";
import { isString } from "radashi";

import { splitIntoChunks } from "./chunk-splitter.js";
import { prepareLines } from "./line-prep.js";
import { reactParse } from "./react-orchestrator.js";
import { ParseStorage } from "./storage.js";

/**
 * ReAct 解析剧本
 *
 * 单一 LLM 节点（chunk-processor）+ 独立 verifier
 * 第一次无格式提示，后续有格式提示（仅作参考）
 * 提示词指令式（步骤化）而非目标式
 *
 * 产出契约：parse:idx:scenes（索引）+ parse:scene:*（数据项）。
 * 下游按 id 逐场景遍历，无需全量文本。
 */
export async function parseScript(ctx: IRunnerContext): Promise<void> {
    const ioInfo = getIOByKeys(ctx, {
        inputs: "script",
        outputs: "parse:idx:scenes",
    });

    if (!ioInfo.expired) {
        ctx.info("[parseScript] 输出仍新鲜，跳过");
        return;
    }

    const storage = new ParseStorage(ctx);

    const scriptArray: string[] = [];
    if (isIdentifiedArray(ioInfo.inputs[0])) {
        ioInfo.inputs[0].forEach((item) => {
            const s = storage.getScriptPart(item.id);
            if (isString(s)) {
                scriptArray.push(s);
            }
        });
    }

    if (scriptArray.length === 0) {
        ctx.info("[parseScript] 未获取到任意剧本正文。");
        return;
    }

    const script = scriptArray.join("\n\n");
    if (!script || script.trim().length < 50) {
        throwPrecondition("[parseScript] 缺少剧本输入，或者剧本正文小于50字。", true);
    }

    const lines = prepareLines(ctx, script);
    const chunks = splitIntoChunks(ctx, lines);

    await reactParse(ctx, lines, chunks);

    // ===== 结束验证：以场景索引非空作为完成标志 =====
    const ids = storage.listSceneIds();
    if (ids.length === 0) {
        ctx.warn("[parseScript] 未识别出任何场景，请检查剧本格式");
        return;
    }

    ctx.notify("场景解析·完成", `共识别 ${ids.length} 个场景`);
    ctx.info(`[parseScript] 完成，parse:idx:scenes ${ids.length} 项`);
}