/* eslint-disable @typescript-eslint/no-explicit-any */
// parse-script/chunk-processor.ts
import { getSmartModel } from "$libs/model/balancer/get-smart-model.js";
import { safefmt } from "$libs/model/llm/outline.js";
import type { IRunnerContext } from "$types/blueprint/context.js";
import { ModelTags } from "$types/shared/model.js";
import { generateText, Output } from "ai";
import { z } from "zod";
import { fmtLines } from "./line-utils.js";
import {
    buildSubsequentChunkPrompt,
    FIRST_CHUNK_PROMPT,
} from "./prompts/chunk-processor.js";
import type { Chunk, ChunkProcessResult, ScriptFormat } from "./types.js";

/**
 * 统一 schema：两种情况（首次有格式更新 / 后续无更新）都用同一份，
 * 通过 nullable + 约定字段"格式一致，无需更新"区分。
 */
const CHUNK_SCHEMA = z.object({
    format_section: z.object({
        format_consistent: z
            .boolean()
            .describe(
                "true = 本片段格式与已知的（或首次推断的）一致，无需更新；" +
                "false = 发现新格式或冲突，需要更新"
            ),
        format_description: z
            .string()
            .nullable()
            .describe(
                "完整更新后的格式描述。仅当 format_consistent=false 时填写；" +
                "否则填 null。用 2-4 句话说明整体结构与格式风格，含原文样例（不要改写）"
            ),
        scene_marker_patterns: z
            .array(z.string())
            .nullable()
            .describe("场景开始标记写法样例（原文片段）；仅当更新时填写，否则 null"),
        episode_act_patterns: z
            .array(z.string())
            .nullable()
            .describe("集/幕标记写法样例；仅当更新时填写，否则 null"),
        transition_patterns: z
            .array(z.string())
            .nullable()
            .describe("转场标记写法样例；仅当更新时填写，否则 null"),
        synopsis_location: z
            .enum(["header", "synopsis_section", "none"])
            .nullable()
            .describe("梗概所在位置；仅当更新时填写，否则 null"),
        cast_location: z
            .enum(["header", "cast_section", "inline", "none"])
            .nullable()
            .describe("人物表所在位置；仅当更新时填写，否则 null"),
    }),

    global_items: z
        .array(
            z.object({
                kind: z
                    .string()
                    .describe("类型：title_page / synopsis / cast / preface / note / 其他"),
                line_start: z.number().describe("起始行号，1-based，含两端"),
                line_end: z.number().describe("结束行号，1-based"),
                summary: z.string().describe("一句话内容摘要"),
            })
        )
        .describe("本片段内识别到的全局信息（梗概、人物表等）；没有则空数组"),

    scenes: z
        .array(
            z.object({
                line_no: z.number().describe("场景起始行号，1-based，与输入中的行号标记完全一致"),
                title_guess: z.string().describe("该场景的标题猜测（一句话）"),
                marker_text: z.string().describe("该行的原文前 60 字符（到第一个换行）"),
            })
        )
        .describe("本片段内的场景起始行；没有则空数组"),

    episode_act_markers: z
        .array(
            z.object({
                line_no: z.number().describe("集/幕标记行号，1-based"),
                kind: z.enum(["episode", "act"]).describe("episode=集，act=幕"),
                text: z.string().describe("标记原文片段"),
            })
        )
        .describe("本片段内的集/幕标记行；没有则空数组"),
});

/**
 * 处理单个 chunk（含窗口期），返回：
 *   - 是否有格式更新
 *   - 全局信息条目
 *   - 主区内的场景候选
 *   - 主区内的集/幕标记
 *
 * 主区外的场景/marker 由 orchestrator 直接丢弃（防窗口误伤）。
 */
export async function processChunk(
    ctx: IRunnerContext,
    chunk: Chunk,
    context: string[],
    mainStart: number,
    mainEnd: number,
    knownFormat: ScriptFormat | null
): Promise<ChunkProcessResult> {
    const chunkNL = fmtLines(
        context,
        mainStart - chunk.window_before,
        mainEnd + chunk.window_after
    );

    const systemPrompt = knownFormat
        ? buildSubsequentChunkPrompt(knownFormat)
        : FIRST_CHUNK_PROMPT;

    const model = getSmartModel({
        requiredAbilities: [ModelTags.Outline],
    }, ctx);

    // === Step A: LLM 产自然语言 Markdown ===
    const { text } = await generateText({
        model,
        prompt:
            `剧本片段（行号格式：<行号>\\t<内容>）：\n\n${chunkNL}\n\n` +
            `请按 system 指令逐步执行并输出 Markdown 报告。`,
        system: systemPrompt,
    });

    // === Step B: safefmt 提取 ===
    const result = await safefmt(
        text,
        Output.object({ schema: CHUNK_SCHEMA }),
        ctx,
    );

    if (!result.success || !result.value) {
        ctx.warn(`[chunk-processor] ${chunk.chunk_id} safefmt 失败`);
        return { format_update: null, global_items: [], scenes: [], episode_act_markers: [] };
    }

    const v = result.value.output;

    // ===== 格式更新 =====
    let formatUpdate: ScriptFormat | null = null;
    if (!v.format_section.format_consistent) {
        if (
            v.format_section.format_description &&
            v.format_section.scene_marker_patterns &&
            v.format_section.synopsis_location &&
            v.format_section.cast_location
        ) {
            formatUpdate = {
                description: v.format_section.format_description,
                scene_marker_patterns: v.format_section.scene_marker_patterns,
                episode_act_patterns: v.format_section.episode_act_patterns ?? [],
                transition_patterns: v.format_section.transition_patterns ?? [],
                synopsis_location: v.format_section.synopsis_location,
                cast_location: v.format_section.cast_location,
            };
        } else {
            ctx.warn(`[chunk-processor] ${chunk.chunk_id} 声称格式变更但字段不全，忽略`);
        }
    }

    // ===== 全局信息（容忍窗口期外）=====
    const globalItems = (v.global_items ?? []).map((g: any) => ({
        kind: g.kind,
        line_start: g.line_start,
        line_end: g.line_end,
        summary: g.summary,
    }));

    // ===== 场景/markers：严格限制在主区 =====
    const scenes = (v.scenes ?? [])
        .filter((s: any) => s.line_no >= mainStart && s.line_no <= mainEnd)
        .map((s: any) => ({
            line_no: s.line_no,
            title_guess: s.title_guess,
            marker_text: s.marker_text,
        }));

    const episodeActMarkers = (v.episode_act_markers ?? [])
        .filter((m: any) => m.line_no >= mainStart && m.line_no <= mainEnd)
        .map((m: any) => ({
            line_no: m.line_no,
            kind: m.kind as "episode" | "act",
            text: m.text,
        }));

    return {
        format_update: formatUpdate,
        global_items: globalItems,
        scenes,
        episode_act_markers: episodeActMarkers,
    };
}