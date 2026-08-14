/**
 * weaver · compile · 语义等价校验
 */

import { getSmartModel } from "$libs/model/balancer/get-smart-model.js";
import { generateText } from "ai";
import type { WeaveContext } from "../../context.js";
import VERIFY_INSTRUCTIONS from "./prompts/verify-semantic-instructions.txt?raw";

export async function verifySemanticEquivalence(
    ctx: WeaveContext,
    originalAction: string,
    planMarkdown: string,
): Promise<string[]> {
    const { text } = await generateText({
        model: getSmartModel(undefined, ctx.ctx),
        instructions: VERIFY_INSTRUCTIONS,
        prompt: [
            `## 原始 action 描述`,
            originalAction,
            ``,
            `## Execution Plan`,
            planMarkdown,
            ``,
            `请校验语义等价性。`,
        ].join("\n"),
    });

    const trimmed = text.trim();
    if (trimmed === "PASS" || trimmed.startsWith("PASS")) return [];

    return trimmed
        .split("\n")
        .map((l) => l.trim())
        .filter((l) => l.length > 0)
        .map((l) => (l.startsWith("[") ? l : `[语义等价] ${l}`));
}