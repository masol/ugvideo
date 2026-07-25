// parse-script/line-verifier.ts
import { getSmartModel } from "$libs/model/balancer/get-smart-model.js";
import { safefmt } from "$libs/model/llm/outline.js";
import type { IRunnerContext } from "$types/blueprint/context.js";
import { ModelTags } from "$types/shared/model.js";
import { generateText, Output } from "ai";
import { z } from "zod";
import { fmtLines } from "./line-utils.js";
import { buildVerifierPrompt } from "./prompts/line-verifier.js";
import type { ScriptFormat } from "./types.js";

export interface VerifiedScene {
    line_no: number;
    confidence: number;
    context: {
        transitions_from_prev?: string;
        rough_location?: string;
        rough_time?: string;
        characters_involved: string[];
        episode_or_act?: string;
        first_line_summary: string;
    };
}

export type VerifierVerdict =
    | { kind: "verified"; scene: VerifiedScene }
    | { kind: "redirect"; actual_line: number; reason: string }
    | { kind: "rejected"; reason: string };

const VERIFIER_SCHEMA = z.object({
    step1_observation: z.string().describe("第一步观察：候选行原文及是否符合已知格式的判断"),

    step2_context_observation: z.string().describe("第二步观察：候选行前3行和后3行的内容描述"),

    step3_judgment: z.object({
        is_scene_start: z.boolean().describe("true=是场景起始，false=不是"),
        confidence: z.number().describe("判定置信度，0.0 - 1.0；低于 0.7 视为不可信"),
        rationale: z.string().describe("判定理由，一句话"),
        actual_start_line: z
            .number()
            .nullable()
            .describe("若不是场景起始且真起始行在邻近±5行内，给出真起始行号（1-based）；否则 null"),
    }),

    step4_context: z
        .object({
            transitions_from_prev: z
                .string()
                .nullable()
                .describe("与上一场景的转场方式：硬切/叠化/淡入淡出/跳切/匹配剪辑/划像/其他；未识别则 null"),
            rough_location: z
                .string()
                .describe("粗略地点，例如 '老旧公寓客厅'；识别不出写空串"),
            rough_time: z
                .string()
                .describe("粗略时间，例如 '白天'/'夜晚'/'黄昏'；识别不出写空串"),
            characters_involved: z
                .array(z.string())
                .describe("出场人物名列表，没有则空数组"),
            episode_or_act: z
                .string()
                .nullable()
                .describe("挂载的集/幕标识，如 '第1集'；未识别则 null"),
            first_line_summary: z
                .string()
                .describe("一句话概括本场景事件"),
        })
        .nullable()
        .describe("第四步上下文；仅当判定为'是'时填写，否则 null"),
});

const CONFIDENCE_THRESHOLD = 0.7;

/**
 * 行级 verifier ——独立上下文，独立判定，支持 redirect
 *
 * 注意：本节点不负责 chunk/scenes/markers 维护，只回答
 * "这一行是不是场景起始？如果不是，真起始在哪一行？"
 */
export async function verifySceneCandidate(
    ctx: IRunnerContext,
    candidate: { line_no: number; marker_text: string },
    lines: string[],
    knownFormat: ScriptFormat | null
): Promise<VerifierVerdict> {
    const ctxStart = Math.max(1, candidate.line_no - 5);
    const ctxEnd = Math.min(lines.length, candidate.line_no + 5);
    const contextNL = fmtLines(lines, ctxStart, ctxEnd);

    const systemPrompt = buildVerifierPrompt(
        candidate.line_no,
        candidate.marker_text,
        contextNL,
        knownFormat
    );

    const model = getSmartModel({
        requiredAbilities: [ModelTags.Outline],
    }, ctx);

    // === Step A: LLM 产自然语言 Markdown ===
    const { text } = await generateText({
        model,
        prompt: systemPrompt,
    });

    // === Step B: safefmt 提取 ===
    const result = await safefmt(
        text,
        Output.object({ schema: VERIFIER_SCHEMA }),
        ctx,
    );

    if (!result.success || !result.value) {
        return { kind: "rejected", reason: "safefmt 失败" };
    }

    const v = result.value.output;

    // 不通过 + 给出真正起始行 → redirect
    if (!v.step3_judgment.is_scene_start && v.step3_judgment.actual_start_line) {
        return {
            kind: "redirect",
            actual_line: v.step3_judgment.actual_start_line,
            reason: v.step3_judgment.rationale,
        };
    }

    if (!v.step3_judgment.is_scene_start) {
        return { kind: "rejected", reason: v.step3_judgment.rationale };
    }

    if (v.step3_judgment.confidence < CONFIDENCE_THRESHOLD) {
        return {
            kind: "rejected",
            reason: `置信度 ${v.step3_judgment.confidence} 低于阈值 ${CONFIDENCE_THRESHOLD}`,
        };
    }

    if (!v.step4_context) {
        return { kind: "rejected", reason: "判定为场景起始但未提供上下文" };
    }

    return {
        kind: "verified",
        scene: {
            line_no: candidate.line_no,
            confidence: v.step3_judgment.confidence,
            context: {
                transitions_from_prev: v.step4_context.transitions_from_prev ?? undefined,
                rough_location: v.step4_context.rough_location || undefined,
                rough_time: v.step4_context.rough_time || undefined,
                characters_involved: v.step4_context.characters_involved ?? [],
                episode_or_act: v.step4_context.episode_or_act ?? undefined,
                first_line_summary: v.step4_context.first_line_summary || "",
            },
        },
    };
}