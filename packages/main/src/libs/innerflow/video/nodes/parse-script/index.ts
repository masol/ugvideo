// parse-script/index.ts
import { checkExpiry } from "$libs/blueprint/glossary/expiry.js";
import { PrjDB } from "$libs/project/controllers/drizzle/index.js";
import { throwPrecondition } from "$libs/utils/err.js";
import type { IRunnerContext } from "$types/blueprint/context.js";

import { splitIntoChunks } from "./chunk-splitter.js";
import { prepareLines } from "./line-prep.js";
import { reactParse } from "./react-orchestrator.js";
import { ParseStorage } from "./storage.js";

/**
 * ReAct 解析剧本
 *
 * 单一LLM 节点（chunk-processor）+ 独立 verifier
 * 第一次无格式提示，后续有格式提示（仅作参考）
 * 提示词指令式（步骤化）而非目标式
 */
export async function parseScript(ctx: IRunnerContext): Promise<void> {
    const prjdb = PrjDB.ensure(ctx.prj);

    if (!checkExpiry(ctx, {
        inputKeys: "input:raw_script",
        outputKeys: "state:scenes_nl",
    })) {
        ctx.info("[parseScript] 输出仍新鲜，跳过");
        return;
    }

    const script = prjdb.get<string>("input:raw_script");
    if (!script || script.trim().length < 50) {
        throwPrecondition("[parseScript] 缺少剧本输入 input:raw_script");
    }

    const lines = prepareLines(ctx);
    const chunks = splitIntoChunks(ctx, lines);

    await reactParse(ctx, lines, chunks);

    // ===== 拼装下游兼容场景列表 =====
    const storage = new ParseStorage(prjdb);
    const ids = storage.listSceneIds().slice().sort((a, b) => {
        const sa = storage.loadScene(a)!;
        const sb = storage.loadScene(b)!;
        return sa.line_start - sb.line_start;
    });

    if (ids.length === 0) {
        ctx.warn("[parseScript] 未识别出任何场景，请检查剧本格式");
        return;
    }

    const scenesNL = ids
        .map((id) => {
            const s = storage.loadScene(id)!;
            const snippet = lines.slice(s.line_start - 1, s.line_end).join("\n");
            return [
                `### ${s.scene_id} ${s.title}`,
                `- **地点**：${s.context.location ?? "(待补)"}`,
                `- **时间**：${s.context.timeOfDay ?? "(待补)"}`,
                `- **在场人物**：${s.context.charactersInvolved?.join("、") || "(待补)"}`,
                `- **集/幕**：${[s.context.episode, s.context.act].filter(Boolean).join(" / ") || "(无)"}`,
                `- **转场**：${s.transition_from_prev ?? "(默认)"}`,
                `- **首行摘要**：${s.context.first_line_summary ?? "(待补)"}`,
                `- **行号区间**：${s.line_start}-${s.line_end}`,
                ``,
                snippet,
                ``,
            ].join("\n");
        })
        .join("\n---\n\n");

    prjdb.set("state:scenes_nl", scenesNL);

    ctx.notify("场景解析·完成", `共识别 ${ids.length} 个场景`);
    ctx.info(`[parseScript] 完成，state:scenes_nl ${scenesNL.length} 字符`);
}