// nodes/parse-script/index.ts
import { isIdentifiedArray } from "$libs/blueprint/blackboard/array.js";
import { getIOByKeys } from "$libs/blueprint/glossary/ioinfo.js";
import { PrjDB } from "$libs/project/controllers/drizzle/index.js";
import { throwPrecondition } from "$libs/utils/err.js";
import type { IRunnerContext } from "$types/blueprint/context.js";
import { isString } from "radashi";

import { splitIntoChunks } from "./chunk-splitter.js";
import { prepareLines } from "./line-prep.js";
import { reactParse } from "./react-orchestrator.js";
import { ParseStorage } from "./storage.js";

/**
 * 工作流首次启动时，把所有 config 默认值落盘一次。
 * 下游所有 checkExpiry(inputKeys 含 config:*) 都依赖这些 key 存在；
 * 若它们从未写过，checkExpiry 内部会把"input 不完整"视为过期，
 * 导致下游反复触发 LLM 重算。
 * 后续用户切风格时，dashboard 应主动 set 新值，config 时间戳自动更新，下游自然感知重算。
 */
function ensureDefaultConfig(prjdb: ReturnType<typeof PrjDB.ensure>): void {
    const defaults: Record<string, string> = {
        "config:pace": "normal",
        "config:aspectRatio": "9:16",
        "config:resolution": "480p",
        "config:frameRate": "24",
        "config:duration": "3min",
        "config:style": "cinematic",
        "config:audience": "pg",
        "config:colorTone": "neutral",
        "config:cameraMovement": "smooth",
    };
    for (const [k, v] of Object.entries(defaults)) {
        if (prjdb.get<string>(k) == null) {
            prjdb.set(k, v);
        }
    }
}

export async function parseScript(ctx: IRunnerContext): Promise<void> {
    const prjdb = PrjDB.ensure(ctx.prj);
    ensureDefaultConfig(prjdb);

    const ioInfo = getIOByKeys(ctx, {
        inputs: "script",
        outputs: "#video:parse:idx:scenes",
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

    const cached = storage.getCachedSynopsis();
    const synopsis = storage.loadSynopsis();
    if (synopsis && cached !== synopsis) {
        storage.saveSynopsis(synopsis);
        ctx.info(`[parseScript] synopsis 落盘，${synopsis.length}字`);
    } else if (!synopsis) {
        ctx.info(`[parseScript] 无 synopsis，下游将从前几场环境推断世界观`);
    }

    const ids = storage.listSceneIds();
    if (ids.length === 0) {
        ctx.warn("[parseScript] 未识别出任何场景，请检查剧本格式");
        return;
    }

    ctx.notify("场景解析·完成", `共识别 ${ids.length} 个场景`);
    ctx.info(`[parseScript] 完成，#video:parse:idx:scenes ${ids.length} 项`);
}