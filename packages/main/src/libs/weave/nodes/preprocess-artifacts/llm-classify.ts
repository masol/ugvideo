/**
 * weaver · preprocess-artifacts · LLM 分类孤儿产物
 */

import { getSmartModel } from "$libs/model/balancer/get-smart-model.js";
import { generateText } from "ai";
import type { WeaveContext } from "../../context.js";
import type { HumanFlow } from "../../types.js";

export interface OrphanClassification {
    shouldBeInputs: string[];
    shouldHaveProducer: string[];
}

export async function classifyOrphanArtifacts(
    ctx: WeaveContext,
    flow: HumanFlow,
    orphanNames: string[],
): Promise<OrphanClassification> {
    if (orphanNames.length === 0) return { shouldBeInputs: [], shouldHaveProducer: [] };

    const { text } = await generateText({
        model: getSmartModel(undefined, ctx.ctx),
        instructions:
            `你是工作流输入边界分析专家。任务：判断每个孤儿产物（被消费但无任何节点产出）` +
            `应该是工作流的外部输入（用户应该提前准备好的素材 / 外部数据源），` +
            `还是应该有节点产出但被遗漏（需补全节点）。\n\n` +
            `判定规则：\n` +
            `1. 若产物名像"用户上传的文件""原始数据""外部API返回""问卷答案"——标记为"输入"；\n` +
            `2. 若产物名像"提炼后的XXX""经过处理的XXX""计算结果"——标记为"缺节点"；\n` +
            `3. 若不确定，默认"输入"（宁可让用户补输入，不要凭空捏造节点）。\n\n` +
            `输出格式（逐行）：\n产物名 | 输入 or 缺节点`,
        prompt:
            `## 工作流\n目的：${flow.intent}\n\n` +
            `## 孤儿产物清单\n${orphanNames.map((n, i) => `${i + 1}. ${n}`).join("\n")}\n\n` +
            `请对每个产物判断并输出。`,
    });

    const lines = text.trim().split("\n");
    const shouldBeInputs: string[] = [];
    const shouldHaveProducer: string[] = [];

    for (const line of lines) {
        const m = line.match(/^(.+?)\s*\|\s*(输入|缺节点)$/);
        if (!m) continue;
        const name = m[1].trim();
        const label = m[2].trim();
        if (label === "输入") shouldBeInputs.push(name);
        else shouldHaveProducer.push(name);
    }

    return { shouldBeInputs, shouldHaveProducer };
}