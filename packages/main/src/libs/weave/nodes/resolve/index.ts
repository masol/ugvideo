/**
 * weaver · node ④ resolve
 *
 * 职责：把 Agent IR 中每个 [invoke] 指令的 <verb> 拟合到现有 skill / tool。
 *
 * 产出：在每个 [invoke] 行末尾追加 `(resolved: skill:<id>)` 或
 *       `(unresolved: needs new skill)`。
 *
 * 输入：单个 FlowNode 的 Agent IR + 全局 DecisionStorage 中的 tool/skill 列表。
 */

import { checkExpiry } from "$libs/blueprint/glossary/expiry.js";
import { getSmartModel } from "$libs/model/balancer/get-smart-model.js";
import { generateText } from "ai";
import type { WeaveContext } from "../../context.js";
import type { HumanFlow } from "../../types.js";

const RESOLVE_INSTRUCTIONS = `你是工作流 invoke 指令拟合专家。

任务：对给定 Agent IR 中的每个 [invoke] <verb> on \`<artifact>\` → \`<output>\` 指令，
判断哪个已有 skill 或 tool 最匹配该动词-产物组合。

候选清单会同时提供。每个候选有 id / signature / description / keywords 字段。

匹配规则：
1. 优先看 description 与 keywords 是否覆盖 invoke 动作；
2. 若 invoke 涉及特定产物类型（如 array of summaries），candidate 也需匹配；
3. 若有多个候选接近，优先选 signature 更通用的；
4. 若所有候选都不匹配，标 unresolved（needs new skill）。

输出：在每个 [invoke] 行末尾追加一个匹配结果标注，格式：
-命中：\`(resolved: skill:<id>)\` 或 \`(resolved: tool:<id>)\`
- 未命中：\`(unresolved: needs new skill)\`

其它行（[parallel] / [when] / [goto] / [await] / [compose] / Inputs / Outputs 段）
严格保持原样，不得改动。

输出格式：完整 markdown（从 # Agent IR for <节点名> 开始），所有 [invoke] 行末尾追加标注。`;

export async function resolveWorkflow(ctx: WeaveContext): Promise<void> {
    const store = ctx.storage.workflow;

    if (!checkExpiry(ctx.ctx, {
        inputKeys: store.latestKey("agent_ir_index"),
        outputKeys: store.latestKey("resolved_ir_index"),
    })) {
        ctx.ctx.info("[resolveWorkflow] 输出仍新鲜，跳过");
        return;
    }

    const mainFlow = findMainFlow(ctx);
    if (!mainFlow) {
        ctx.ctx.notify("resolve", "无主工作流，跳过");
        return;
    }

    const candidates = buildCandidates(ctx);
    const nodeIds = store.getAgentIRIndex() ?? [];

    for (const nodeId of nodeIds) {
        await resolveNode(ctx, nodeId, candidates, mainFlow);
    }

    store.saveResolvedIRIndex(nodeIds);
    ctx.ctx.notify("resolve 完成", `${nodeIds.length} 个步骤已拟合`);
}

async function resolveNode(
    ctx: WeaveContext,
    nodeId: string,
    candidates: string,
    _flow: HumanFlow,
): Promise<void> {
    const store = ctx.storage.workflow;
    const outKey = store.latestKey(`resolved_ir:${nodeId}`);

    if (!checkExpiry(ctx.ctx, {
        inputKeys: store.latestKey(`agent_ir:${nodeId}`),
        outputKeys: outKey,
    })) {
        const cached = store.getResolvedIR(nodeId);
        if (cached) return;
    }

    const ir = store.getAgentIR(nodeId);
    if (!ir) return;

    const { text } = await generateText({
        model: getSmartModel(undefined, ctx.ctx),
        instructions: RESOLVE_INSTRUCTIONS,
        prompt:
            `## 候选 skill / tool 清单\n${candidates}\n\n` +
            `## 待拟合的 Agent IR\n${ir}\n\n` +
            `请在每个 [invoke] 行末尾追加匹配标注，输出完整 markdown。`,
    });

    store.saveResolvedIR(nodeId, text);
}

function buildCandidates(ctx: WeaveContext): string {
    const lines: string[] = [];

    for (const id of ctx.storage.decision.listSkillIds()) {
        const s = ctx.storage.decision.getSkill(id);
        if (!s) continue;
        lines.push(
            `- skill:${s.id}\n  signature: ${s.signature}\n  description: ${s.promptTemplate.system.slice(0, 200)}`,
        );
    }

    for (const id of ctx.storage.decision.listToolIds()) {
        const t = ctx.storage.decision.getTool(id);
        if (!t) continue;
        lines.push(
            `- tool:${t.name}\n  description: ${t.description}\n  keywords: ${t.keywords.join(", ")}`,
        );
    }

    return lines.length > 0 ? lines.join("\n\n") : "（无任何 skill / tool）";
}

function findMainFlow(ctx: WeaveContext): HumanFlow | null {
    const flows = ctx.conceptManager.listHumanFlows();
    return flows.find((f) => (f as HumanFlow).isMain === true) ?? flows[0] ?? null;
}