/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * weaver · node ③ compile（v10）
 *
 * v10 变更：
 *   - 未收敛节点不落盘，直接抛错（而非保存 unconverged plan）；
 *   - 只有全部节点收敛才落盘 function_plan_index。
 */
import { checkExpiry } from "$libs/blueprint/glossary/expiry.js";
import { configService } from "$libs/store/index.js";
import { throwUnprcessable } from "$libs/utils/err.js";
import type { ModelMessage } from "ai";
import pMap from "p-map";
import type { WeaveContext } from "../../context.js";
import type { ArtifactRelation, FlowNode, HumanFlow, HumanNode } from "../../types.js";
import { buildFunctionPlan, type BuildPlanInput } from "./build-function-plan.js";
import type { AttemptRecord, FunctionPlan } from "./parse-types.js";
import {
    detectParallelism,
    verifyFunctionPlan,
    type VerificationResult,
} from "./verify-structure.js";
const STAGNATION_LIMIT = 3;
export async function compileWorkflow(ctx: WeaveContext): Promise<void> {
    const store = ctx.storage.workflow;
    if (!checkExpiry(ctx.ctx, {
        inputKeys: store.latestKey("artifact_relations"),
        outputKeys: store.latestKey("function_plan_index"),
    })) {
        ctx.ctx.info("[compileWorkflow] 输出仍新鲜，跳过");
        return;
    }
    const mainFlow = findMainFlow(ctx);
    if (!mainFlow) {
        ctx.ctx.notify("compile", "无主工作流，跳过");
        return;
    }
    const relations = store.getArtifactRelations() ?? {};
    const allNodes: HumanNode[] = [];
    mainFlow.g.forEachNode((id) => {
        const n = ctx.conceptManager.nodes.get(id);
        if (n) allNodes.push(n as HumanNode);
    });
    ctx.ctx.notify("compile", `开始编译 ${allNodes.length} 个步骤`);
    const maxRounds = ctx.storage.config.getMaxReactRounds();
    const concurrency = Math.max(configService().get("concurrency") || 4, 2);
    const prevIndexExists = store.getFunctionPlanIndex() != null;
    const availableTools = collectAvailableTools(ctx);
    const results: { node: HumanNode; plan: FunctionPlan; code: string }[] = [];
    const unconvergedNodes: string[] = [];
    await pMap(
        allNodes,
        async (node) => {
            const out = await compileNode(
                ctx,
                mainFlow,
                node,
                relations,
                availableTools,
                maxRounds,
                prevIndexExists,
            );
            if (out.exceeded) {
                unconvergedNodes.push(node.name);
            } else {
                results.push({ node: out.node, plan: out.plan, code: out.code });
            }
        },
        { concurrency, stopOnError: false },
    );
    // 未收敛节点存在时，不落盘，直接报错
    if (unconvergedNodes.length > 0) {
        throwUnprcessable(
            `[compile] 以下步骤未收敛，编译失败：${unconvergedNodes.join("、")}`,
        );
    }
    // 全部收敛，落盘
    const nodeIds: string[] = [];
    for (const { node, plan, code } of results) {
        store.saveFunctionPlan(node.id, plan);
        store.saveFunctionCode(node.id, code);
        nodeIds.push(node.id);
    }
    store.saveFunctionPlanIndex(nodeIds);
    ctx.ctx.notify("compile 完成", `${nodeIds.length} 个步骤全部收敛`);
}
interface CompileNodeOutcome {
    node: HumanNode;
    plan: FunctionPlan;
    code: string;
    exceeded: boolean;
}
async function compileNode(
    ctx: WeaveContext,
    flow: HumanFlow,
    node: HumanNode,
    relations: Record<string, ArtifactRelation>,
    availableTools: string[],
    maxRounds: number,
    prevIndexExists: boolean,
): Promise<CompileNodeOutcome> {
    const store = ctx.storage.workflow;
    if (prevIndexExists) {
        const planKey = store.latestKey(`function_plan:${node.id}`);
        if (!checkExpiry(ctx.ctx, {
            inputKeys: store.latestKey("artifact_relations"),
            outputKeys: planKey,
        })) {
            const cachedPlan = store.getFunctionPlan(node.id);
            const cachedCode = store.getFunctionCode(node.id);
            if (cachedPlan && cachedCode) {
                return { node, plan: cachedPlan, code: cachedCode, exceeded: false };
            }
        }
    }
    const predecessorOutputs = collectPredecessorOutputs(ctx, flow, node);
    const artifactContext = buildArtifactContext(node, relations, predecessorOutputs, flow.inputs);
    const input: BuildPlanInput = {
        node,
        flowIntent: flow.intent,
        artifactContext,
        predecessorOutputs,
        flowInputs: flow.inputs,
        availableTools,
    };
    let messages: ModelMessage[] | undefined;
    let lastFeedback: string[] = [];
    let lastPlan: FunctionPlan | null = null;
    let lastCode = "";
    const attemptHistory: AttemptRecord[] = [];
    let lastFeedbackKey = "";
    let stagnationCount = 0;
    for (let round = 0; round < maxRounds; round++) {
        ctx.ctx.notify(
            "compile",
            `步骤「${node.name}」第 ${round + 1}/${maxRounds} 轮` +
            (lastFeedback.length > 0 ? `（${lastFeedback.length} 条反馈）` : ""),
        );
        let buildResult;
        try {
            buildResult = await buildFunctionPlan(
                ctx,
                input,
                messages,
                lastFeedback.length > 0 ? lastFeedback : undefined,
            );
        } catch (e: any) {
            ctx.ctx.info(`[compile] 步骤「${node.name}」第 ${round + 1} 轮 LLM 失败：${e?.message ?? e}`);
            attemptHistory.push({
                round: round + 1,
                feedbacks: [{ kind: "structure", msg: "LLM 调用失败：" + (e?.message ?? String(e)) }],
            });
            break;
        }
        messages = buildResult.messages;
        lastPlan = buildResult.plan;
        lastCode = buildResult.code;
        const verify: VerificationResult = await verifyFunctionPlan(
            buildResult.plan,
            buildResult.code,
            node.inputs,
            node.outputs,
            buildResult.catalog,
            node,
        );
        const hint = detectParallelism(buildResult.code);
        if (hint.kind !== "sequential") {
            lastPlan.parallelismHint = hint;
        } else {
            delete lastPlan.parallelismHint;
        }
        if (verify.valid) {
            ctx.ctx.info(`[compile] 步骤「${node.name}」第 ${round + 1} 轮通过`);
            return { node, plan: lastPlan, code: lastCode, exceeded: false };
        }
        attemptHistory.push({ round: round + 1, feedbacks: verify.feedback });
        for (const fb of verify.feedback.slice(0, 3)) {
            ctx.ctx.info(`[compile] 「${node.name}」R${round + 1} [${fb.kind}] ${fb.msg}`);
        }
        const currentKey = verify.feedback
            .map((f) => `${f.kind}::${f.msg}`)
            .sort()
            .join("|");
        if (currentKey === lastFeedbackKey && lastFeedbackKey.length > 0) {
            stagnationCount++;
            if (stagnationCount >= STAGNATION_LIMIT) {
                ctx.ctx.info(`[compile] 步骤「${node.name}」反馈连续未变化，早停`);
                break;
            }
        } else {
            stagnationCount = 0;
            lastFeedbackKey = currentKey;
        }
        lastFeedback = verify.feedback.map((f) => `[${f.kind}] ${f.msg}`);
    }
    // 未收敛
    ctx.ctx.info(`[compile] 步骤「${node.name}」未收敛（最后 ${lastFeedback.length} 条反馈）`);
    return {
        node,
        plan: lastPlan ?? {
            sourceNodeId: node.id,
            sourceNodeName: node.name,
            apiKind: "code",
            language: "js",
            instructions: [],
        },
        code: lastCode,
        exceeded: true,
    };
}
// ════════════════════════════════════════════════════════════════
// 辅助
// ════════════════════════════════════════════════════════════════
function findMainFlow(ctx: WeaveContext): HumanFlow | null {
    const flows = ctx.conceptManager.listHumanFlows();
    return flows.find((f) => f.isMain === true) ?? flows[0] ?? null;
}
function collectPredecessorOutputs(
    ctx: WeaveContext,
    flow: HumanFlow,
    node: FlowNode,
): string[] {
    const out: string[] = [];
    flow.g.forEachInNeighbor(node.id, (predecessorId) => {
        const pred = ctx.conceptManager.nodes.get(predecessorId);
        if (pred) {
            for (const outId of pred.outputs) {
                const a = ctx.conceptManager.artifacts.get(outId);
                if (a) out.push(a.name);
            }
        }
    });
    return [...new Set(out)];
}
function buildArtifactContext(
    node: FlowNode,
    relations: Record<string, ArtifactRelation>,
    predecessorOutputs: string[],
    flowInputs: string[],
): string {
    const involved = new Set<string>([
        ...node.inputs,
        ...node.outputs,
        ...predecessorOutputs,
        ...flowInputs,
    ]);
    const lines: string[] = [];
    for (const name of involved) {
        const rel = relations[name];
        if (!rel) {
            lines.push(`- \`${name}\``);
            continue;
        }
        const parts: string[] = [`\`${name}\``];
        if (rel.partOf && rel.partOf.length > 0) parts.push(`partOf: [${rel.partOf.join(", ")}]`);
        if (rel.composedOf && rel.composedOf.length > 0) parts.push(`composedOf: [${rel.composedOf.join(", ")}]`);
        if (rel.arrayOf) parts.push(`arrayOf: ${rel.arrayOf}`);
        if (rel.refinedFrom && rel.refinedFrom.length > 0) parts.push(`refinedFrom: [${rel.refinedFrom.join(", ")}]`);
        lines.push(`- ${parts.join(", ")}`);
    }
    return lines.join("\n");
}
function collectAvailableTools(ctx: WeaveContext): string[] {
    try {
        return ctx.storage.decision.listToolIds();
    } catch {
        return [];
    }
}
type _VR = VerificationResult;