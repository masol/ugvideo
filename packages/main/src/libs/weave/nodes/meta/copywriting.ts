/**
 * weaver · meta · 文案生成（一次 LLM + safefmt，无 reAct）
 */

import { getSmartModel } from "$libs/model/balancer/get-smart-model.js";
import { safefmt } from "$libs/model/llm/outline.js";
import { throwUnprcessable } from "$libs/utils/err.js";
import { generateText, Output } from "ai";
import { z } from "zod";
import type { WeaveContext } from "../../context.js";
import type { HumanFlow, HumanNode } from "../../types.js";
import type { MainInputArtifact } from "./index.js";

export interface Copywriting {
    workflowName: string;
    workflowDesc: string;
    idleHint: string;
    checkInputTitle: string;
    checkInputDesc: string;
    targetLabels: string[];
    targetDescs: string[];
    inputSectionTitle: string;
    configSectionTitle: string;
    mainInputAddLabel: string;
    mainInputEmptyTitle: string;
    mainInputAddDialogTitle: string;
    mainInputEditDialogTitle: string;
    mainInputEditDialogDesc: string;
    mainInputConfirmTitle: string;
    mainInputConfirmMessage: string;
}

export async function generateCopywriting(
    ctx: WeaveContext,
    flow: HumanFlow,
    nodes: HumanNode[],
    levels: string[][],
    mainInput: MainInputArtifact,
): Promise<Copywriting> {
    const nodeList = nodes.map((n, i) => `${i + 1}. ${n.name}（${n.intent}）`).join("\n");
    const levelList = levels.map((lv, i) => `第 ${i + 1} 代：${lv.join("、")}`).join("\n");
    const mainInputDesc = mainInput.exists
        ? `主输入「${mainInput.name}」，语义：${mainInput.intent}`
        : "（无主输入）";

    const { text } = await generateText({
        model: getSmartModel(undefined, ctx.ctx),
        instructions:
            "你是产品文案撰写专家。根据工作流信息，为 UI 各项填写简洁的中文文案。" +
            "按项目逐条输出，每段文案独立成行。",
        prompt:
            `## 工作流信息\n` +
            `- 总目标：${flow.intent}\n` +
            `- 步骤：\n${nodeList}\n` +
            `- DAG 代数（${levels.length} 代）：\n${levelList}\n` +
            `- ${mainInputDesc}\n\n` +
            `请为以下 16 个项目各写一段简短文案：\n` +
            `1. 工作流名称（<= 15 字，动宾结构）\n` +
            `2. 工作流简介（<= 80 字）\n` +
            `3. 空闲态提示（<= 50 字）\n` +
            `4. 缺输入标题（<= 15 字）\n` +
            `5. 缺输入描述（<= 40 字）\n` +
            `6. 每代标签名（各 <= 10 字，共 ${levels.length} 个）\n` +
            `7. 每代描述（各 <= 30 字，共 ${levels.length} 个）\n` +
            `8. 输入管理区块标题（<= 8 字）\n` +
            `9. 配置区块标题（<= 8 字）\n` +
            `10. 主输入「添加」按钮（<= 10 字）\n` +
            `11. 主输入「空列表」提示（<= 15 字）\n` +
            `12. 主输入「添加对话框」标题（<= 15 字）\n` +
            `13. 主输入「编辑对话框」标题（<= 15 字）\n` +
            `14. 主输入「编辑对话框」描述（<= 50 字）\n` +
            `15. 主输入「删除确认」标题（<= 15 字）\n` +
            `16. 主输入「删除确认」消息（<= 50 字）`,
    });

    const schema = z.object({
        workflowName: z.string().describe("工作流名称"),
        workflowDesc: z.string().describe("工作流简介"),
        idleHint: z.string().describe("空闲态提示"),
        checkInputTitle: z.string().describe("缺输入标题"),
        checkInputDesc: z.string().describe("缺输入描述"),
        targetLabels: z.array(z.string()).describe("每代标签名数组"),
        targetDescs: z.array(z.string()).describe("每代描述数组"),
        inputSectionTitle: z.string().describe("输入区块标题"),
        configSectionTitle: z.string().describe("配置区块标题"),
        mainInputAddLabel: z.string().describe("添加按钮文案"),
        mainInputEmptyTitle: z.string().describe("空列表提示"),
        mainInputAddDialogTitle: z.string().describe("添加对话框标题"),
        mainInputEditDialogTitle: z.string().describe("编辑对话框标题"),
        mainInputEditDialogDesc: z.string().describe("编辑对话框描述"),
        mainInputConfirmTitle: z.string().describe("删除确认标题"),
        mainInputConfirmMessage: z.string().describe("删除确认消息"),
    });

    const result = await safefmt(text, Output.object({ schema }), ctx.ctx);
    if (!result.success || !result.value) {
        throwUnprcessable("[meta] 文案 safefmt 提取失败");
    }

    return result.value.output as Copywriting;
}