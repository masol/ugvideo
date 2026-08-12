/**
 * weaver · parse · 缺口补全
 */

import { getSmartModel } from "$libs/model/balancer/get-smart-model.js";
import { generateText } from "ai";
import type { WeaveContext } from "../../context.js";
import { ConflictSignal } from "../../types.js";
import { parseMarkdown } from "./index.js";
import { tryStandard } from "./standard.js";

export async function fillGaps(
    ctx: WeaveContext,
    doc: string,
    initialErrors: string[],
    docIndex: number,
): Promise<string> {
    const maxRounds = ctx.storage.config.getMaxReactRounds();
    const errors = [...initialErrors];
    let augment = "";

    for (let round = 1; round <= maxRounds; round++) {
        ctx.ctx.notify("fill-gaps", `doc ${docIndex + 1} 第 ${round} 轮，缺口 ${errors.length} 条`);

        const current = augment ? `${doc}\n\n---\n\n${augment}` : doc;
        const tree = parseMarkdown(current);
        const astResult = tryStandard(tree, ctx);

        if (astResult.flow) {
            return current;
        }

        try {
            const { text: patch } = await generateText({
                model: getSmartModel(undefined, ctx.ctx),
                instructions: GAP_INSTRUCTIONS,
                prompt: buildGapPrompt(doc, augment, astResult.errors, round),
            });

            augment = augment
                ? `${augment}\n\n---\n\n## 第 ${round} 轮补丁\n\n${patch}`
                : `## 第 ${round} 轮补丁\n\n${patch}`;

            errors.splice(0, errors.length, ...astResult.errors);
        } catch (e) {
            if (e instanceof ConflictSignal) {
                errors.splice(0, errors.length, ...e.feedback.split("\n"));
                continue;
            }
            throw e;
        }
    }

    throw new Error(
        `[fill-gaps] doc ${docIndex + 1} 在 ${maxRounds} 轮内未收敛；最后缺口：\n${errors.join("\n")}`,
    );
}

function buildGapPrompt(doc: string, augment: string, errors: string[], round: number): string {
    return `## 工作流原文（只读，不要修改）

${doc}

${augment ? `## 已应用的补丁\n\n${augment}\n` : ""}
## 当前缺口（第 ${round} 轮）

以下字段/约束在解析后无法闭合，请逐一用 markdown 自然语言作答：

${errors.map((e, i) => `${i + 1}. ${e}`).join("\n")}

## 补全要求

1. 每条缺口对应一段自然语言回答，给出**具体步骤名、字段值、artifact 名**。
2. 不要整体重写工作流——只针对缺口作答。
3. artifact 名、节点名、条件值都必须用反引号包裹：\`xxx\`。
4. 如果缺口是"路径级输入不闭合"——指出**哪条路径缺哪个 artifact**、**在哪一步骤产出该 artifact**。
5. 如果缺口是"terminal 不唯一"——指明**哪些步骤应该是 terminal**、**哪些步骤的出边条件是什么**。`;
}

const GAP_INSTRUCTIONS = `你是一名工作流补全助手。给定工作流原文 + 当前解析缺口列表，逐一回答每条缺口。

硬性要求：
1. 严禁输出 JSON。输出必须是 markdown。
2. 严禁整体重写工作流。只针对缺口作答。
3. artifact、节点名、条件值都用反引号包裹。
4. 回答要具体、可执行——给步骤名而不给抽象原则。`;