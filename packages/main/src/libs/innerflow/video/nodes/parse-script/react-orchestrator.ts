/* eslint-disable @typescript-eslint/no-explicit-any */
// parse-script/react-orchestrator.ts
import { PrjDB } from "$libs/project/controllers/drizzle/index.js";
import type { IRunnerContext } from "$types/blueprint/context.js";
import { processChunk } from "./chunk-processor.js";
import { sliceChunk } from "./chunk-splitter.js";
import { getLine } from "./line-utils.js";
import {
    verifySceneCandidate,
    type VerifierVerdict,
} from "./line-verifier.js";
import { ParseStorage } from "./storage.js";
import type { Chunk, PersistedScene } from "./types.js";

const MAX_REDIRECT_DEPTH = 3;

export async function reactParse(
    ctx: IRunnerContext,
    lines: string[],
    chunks: Chunk[]
): Promise<void> {
    const prjdb = PrjDB.ensure(ctx.prj);
    const storage = new ParseStorage(prjdb);

    // 加载已知格式（首次为 null）
    let knownFormat = storage.loadFormat();

    for (const chunk of chunks) {
        ctx.notify(
            "场景解析·ReAct",
            `处理 ${chunk.chunk_id}（行 ${chunk.line_start}-${chunk.line_end}）`
        );

        const { context, main_start, main_end } = sliceChunk(lines, chunk);

        // ===== 单次 LLM：扫格式+全局+场景+marcers =====
        const result = await processChunk(
            ctx,
            chunk,
            context,
            main_start,
            main_end,
            knownFormat
        );

        // ===== 处理格式更新 =====
        if (result.format_update) {
            storage.saveFormat(result.format_update);
            knownFormat = result.format_update;
            ctx.info(`[react] 格式已更新：${result.format_update.description.slice(0, 50)}...`);
        }

        // ===== 处理全局信息（跨 chunk 累积）=====
        for (const item of result.global_items) {
            storage.appendGlobalItem(item);
        }

        // ===== 处理集/幕标记：用于挂载到后续场景 =====
        let currentEpisode: string | undefined;
        let currentAct: string | undefined;
        // 先回填 chunk 之前是否有已落盘场景带 episode/act
        const existingIds = storage.listSceneIds();
        for (const id of existingIds) {
            const s = storage.loadScene(id);
            if (!s) continue;
            if (s.line_start < main_start) {
                if (s.context.episode) currentEpisode = s.context.episode;
                if (s.context.act) currentAct = s.context.act;
            }
        }

        // 时序合并 markers 与场景候选
        const merged = [
            ...result.scenes.map((s) => ({ kind: "scene" as const, line_no: s.line_no, payload: s })),
            ...result.episode_act_markers.map((m) => ({
                kind: m.kind as "episode" | "act",
                line_no: m.line_no,
                payload: m,
            })),
        ].sort((a, b) => a.line_no - b.line_no);

        for (const item of merged) {
            if (item.kind === "episode") {
                currentEpisode = (item.payload as any).text;
                continue;
            }
            if (item.kind === "act") {
                currentAct = (item.payload as any).text;
                continue;
            }

            const cand = item.payload as { line_no: number; title_guess: string; marker_text: string };

            // ===== 跨 chunk 去重 =====
            let dup = false;
            for (const id of existingIds) {
                const s = storage.loadScene(id);
                if (s && s.line_start === cand.line_no) { dup = true; break; }
            }
            if (dup) continue;

            // ===== 行级 verifier（带重定向）=====
            let currentLineNo = cand.line_no;
            let verdict: VerifierVerdict | null = null;

            for (let depth = 0; depth <= MAX_REDIRECT_DEPTH; depth++) {
                verdict = await verifySceneCandidate(
                    ctx,
                    { line_no: currentLineNo, marker_text: getLine(lines, currentLineNo) },
                    lines,
                    knownFormat
                );
                if (verdict.kind === "verified") break;
                if (verdict.kind === "redirect" && verdict.actual_line) {
                    currentLineNo = verdict.actual_line;
                    continue;
                }
                break;
            }

            if (!verdict || verdict.kind !== "verified" || !verdict.scene) {
                ctx.warn(
                    `[react] 行 ${cand.line_no} (chunk ${chunk.chunk_id}) 未通过 verifier：` +
                    // @ts-expect-error 不写类型了。
                    (verdict?.reason ?? "未知")
                );
                continue;
            }

            // ===== 落盘 =====
            const newIdx = storage.listSceneIds().length;
            const sceneId = `S${String(newIdx + 1).padStart(3, "0")}`;

            const persisted: PersistedScene = {
                scene_id: sceneId,
                title: cand.title_guess,
                line_start: verdict.scene.line_no,
                line_end: -1,
                transition_from_prev: verdict.scene.context.transitions_from_prev,
                context: {
                    episode: currentEpisode,
                    act: currentAct,
                    location: verdict.scene.context.rough_location,
                    timeOfDay: verdict.scene.context.rough_time,
                    charactersInvolved: verdict.scene.context.characters_involved,
                    first_line_summary: verdict.scene.context.first_line_summary,
                },
            };

            storage.saveScene(persisted);
            ctx.info(
                `[react] 落盘 ${sceneId}: "${cand.title_guess}" @ 行 ${verdict.scene.line_no}`
            );
        }

        // ===== cursor 推进 =====
        storage.setCursor(main_end + 1);
    }

    // ===== 后处理：回填 line_end =====
    const ids = storage.listSceneIds();
    const ordered = ids.slice().sort((a, b) => {
        const sa = storage.loadScene(a)!;
        const sb = storage.loadScene(b)!;
        return sa.line_start - sb.line_start;
    });

    for (let i = 0; i < ordered.length; i++) {
        const cur = storage.loadScene(ordered[i])!;
        const next = ordered[i + 1] ? storage.loadScene(ordered[i + 1])! : null;
        cur.line_end = next ? next.line_start - 1 : lines.length;
        storage.saveScene(cur);
    }
}