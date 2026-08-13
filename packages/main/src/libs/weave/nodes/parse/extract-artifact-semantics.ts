/**
 * weaver · parse · 交付物语义作用抽取（专职子 LLM）
 *
 * 目的：为每个 artifact / config 生成"在整个工作流全局中的语义作用"描述，
 * 回填到 intent。DAG 的边已表达"谁产出谁消费"，因此这里【只描述交付物本身的
 * 语义含义与全局意义】，绝不复述连接关系——为后续结构规划与代码生成阶段
 * 更好地理解交付物提供依据。
 *
 * 两步走（NL → safefmt）：
 *   1. generateText：指令式提示词引导模型产出逐条语义分析（markdown 行）；
 *   2. safefmt：把分析结构化为 { name, role }[]，质量由 describe 决定。
 */

import { getSmartModel } from "$libs/model/balancer/get-smart-model.js";
import { safefmt } from "$libs/model/llm/outline.js";
import { generateText, Output } from "ai";
import { z } from "zod";
import type { WeaveContext } from "../../context.js";
import type { ArtifactSemantic } from "./parse-types.js";

const SEMANTICS_INSTRUCTIONS = `你是工作流数据流语义分析专家。

你的任务：针对给定工作流中出现的每一个交付物（数据 / 内容实体），用一句话说清它在整个工作流全局中的语义作用。

对清单中的每一个交付物，严格按以下要求描述：
1. 指出它代表什么信息或内容实体（它"是什么"）；
2. 说明它体现了整个流程的哪个阶段性成果或最终成果、对达成流程总目标起什么作用（它"为什么存在"）；
3. 只描述该交付物自身的语义含义与全局意义。

严格禁止：
- 禁止描述"它是某步骤的输入 / 输出""它被某步骤消费 / 产出""它由某步骤生成"这类节点连接关系——这类信息由流程图承载，此处不得重复；
- 禁止复述某个步骤的具体动作细节；
- 禁止遗漏清单中的任何一个交付物，也禁止新增清单之外的名称。

输出格式：每个交付物占一行，形如"名称：语义作用"。只输出这些行，不要任何额外说明或标题。`;

export async function extractArtifactSemantics(
    ctx: WeaveContext,
    workflowDoc: string,
    artifactNames: string[],
): Promise<ArtifactSemantic[]> {
    if (artifactNames.length === 0) return [];

    const nameList = artifactNames.map((n, i) => `${i + 1}. ${n}`).join("\n");

    const { text } = await generateText({
        model: getSmartModel(undefined, ctx.ctx),
        instructions: SEMANTICS_INSTRUCTIONS,
        prompt:
            `## 工作流文档\n${workflowDoc}\n\n` +
            `## 待分析的交付物清单\n${nameList}\n\n` +
            `请对清单中的每一个交付物，各输出一行"名称：语义作用"。`,
    });

    const schema = z.object({
        artifacts: z
            .array(
                z.object({
                    name: z
                        .string()
                        .describe("交付物名称，必须与待分析清单中的名称逐字完全一致，不得改写。"),
                    role: z
                        .string()
                        .describe(
                            "该交付物在整个工作流中承载的语义作用：它代表什么信息 / 内容实体、" +
                            "体现了流程的哪个阶段性或最终成果、对达成流程总目标有何意义。" +
                            "不得包含'它是某步骤的输入 / 输出''被某步骤消费 / 产出'这类连接关系描述。",
                        ),
                }),
            )
            .describe("清单中每个交付物的语义作用，逐一对应，不遗漏、不新增。"),
    });

    const result = await safefmt(text, Output.object({ schema }), ctx.ctx);
    if (!result.success || !result.value) return [];

    const { artifacts } = result.value.output as { artifacts: ArtifactSemantic[] };

    return artifacts
        .map((a) => ({ name: (a.name ?? "").trim(), role: (a.role ?? "").trim() }))
        .filter((a) => a.name.length > 0 && a.role.length > 0);
}