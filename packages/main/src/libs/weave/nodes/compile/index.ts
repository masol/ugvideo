/**
 * weaver · node ③ compile
 *
 * 职责：把每个 HumanNode 的 actionAtom 编译为 TS 伪代码（reAct 结构）。
 *
 * 设计哲学：伪代码是骨架，不是最终代码。一轮生成 + 轻量结构检查即可。
 * 结构检查不过才重试，最多 maxRounds 轮。语义正确性由编译指令的上下文保证
 * （action 原文直接出现在 prompt 里），不再用第二个 LLM 做互相否定的校验。
 *
 * 存储分离：
 *   - #weave:wf:function_plan:<nodeId> — 元信息（api_kind、instructions、externalFunctions）
 *   - #weave:wf:function_code:<nodeId> — TS 伪代码
 *
 * 缓存策略：
 *   - 顶层门控：function_plan_index 存在且 artifact_relations 未变 → 跳过
 *   - 逐节点缓存：仅当 function_plan_index 已存在时才生效
 *   - 任何节点超出 maxRounds → 不写 function_plan_index → 下次全量重算
 */

import { checkExpiry } from "$libs/blueprint/glossary/expiry.js";
import { configService } from "$libs/store/index.js";
import type { ModelMessage } from "ai";
import pMap from "p-map";
import type { WeaveContext } from "../../context.js";
import type {
    ArtifactRelation,
    FlowNode,
    HumanFlow,
    HumanNode,
} from "../../types.js";
import { buildFunctionPlan, type BuildPlanInput } from "./build-function-plan.js";
import type { AttemptRecord, FunctionPlan } from "./parse-types.js";
import { verifyFunctionPlan } from "./verify-structure.js";

/** 连续 N 轮反馈完全一致则早停 */
const STAGNATION_LIMIT = 2;

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
    const allNodes = mainFlow.g.nodes()
        .map((id) => ctx.conceptManager.nodes.get(id))
        .filter((n): n is HumanNode => n !== null);

    ctx.ctx.notify("compile", `开始编译 ${allNodes.length} 个步骤`);

    const maxRounds = ctx.storage.config.getMaxReactRounds();
    const concurrency = Math.max(configService().get("concurrency") || 4, 2);
    const prevIndexExists = store.getFunctionPlanIndex() != null;

    const nodeIds: string[] = [];
    const unconvergedNodeIds: string[] = [];
    let anyExceeded = false;

    await pMap(allNodes, async (node) => {
        const { plan, code, exceeded } = await compileNode(
            ctx,
            mainFlow,
            node,
            relations,
            maxRounds,
            prevIndexExists,
        );
        store.saveFunctionPlan(node.id, plan);
        store.saveFunctionCode(node.id, code);
        nodeIds.push(node.id);
        if (exceeded) {
            unconvergedNodeIds.push(node.id);
            anyExceeded = true;
        }
    }, { concurrency });

    if (anyExceeded) {
        ctx.ctx.notify(
            "compile 完成（含未收敛节点）",
            `${nodeIds.length} 个步骤已编译，未收敛：${unconvergedNodeIds.join("、")}`,
        );
    } else {
        store.saveFunctionPlanIndex(nodeIds);
        ctx.ctx.notify("compile 完成", `${nodeIds.length} 个步骤全部收敛`);
    }
}

interface CompileNodeResult {
    plan: FunctionPlan;
    code: string;
    exceeded: boolean;
}

async function compileNode(
    ctx: WeaveContext,
    flow: HumanFlow,
    node: FlowNode,
    relations: Record<string, ArtifactRelation>,
    maxRounds: number,
    prevIndexExists: boolean,
): Promise<CompileNodeResult> {
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
                return { plan: cachedPlan, code: cachedCode, exceeded: false };
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
    };

    let messages: ModelMessage[] | undefined = undefined;
    let lastFeedback: string[] = [];
    let lastPlan: FunctionPlan | null = null;
    let lastCode: string = "";
    const attemptHistory: AttemptRecord[] = [];
    let stagnationCount = 0;
    let previousFeedbackKey = "";

    for (let round = 0; round < maxRounds; round++) {
        ctx.ctx.notify(
            "compile",
            `步骤「${node.name}」第 ${round + 1}/${maxRounds} 轮` +
            (lastFeedback.length > 0 ? `（${lastFeedback.length} 条反馈）` : ""),
        );

        const result = await buildFunctionPlan(
            ctx,
            input,
            messages,
            lastFeedback.length > 0 ? lastFeedback : undefined,
        );
        messages = result.messages;
        lastPlan = result.plan;
        lastCode = result.code;

        // 轻量结构校验（纯规则，无 LLM）
        const codeResult = verifyFunctionPlan(result.plan, result.code, node.inputs);

        if (codeResult.valid) {
            ctx.ctx.info(`[compile] 步骤「${node.name}」第 ${round + 1} 轮通过`);
            return { plan: result.plan, code: result.code, exceeded: false };
        }

        // 记录历史
        const tagged = codeResult.feedback.map((f) => ({ kind: "structure" as const, msg: f }));
        attemptHistory.push({ round: round + 1, feedbacks: tagged });

        // 日志
        for (const fb of codeResult.feedback.slice(0, 3)) {
            ctx.ctx.info(`[compile] 「${node.name}」R${round + 1} ${fb}`);
        }

        // 早停：反馈未变化
        const currentFeedbackKey = codeResult.feedback.join("|");
        if (currentFeedbackKey === previousFeedbackKey) {
            stagnationCount++;
            if (stagnationCount >= STAGNATION_LIMIT) {
                ctx.ctx.info(
                    `[compile] 步骤「${node.name}」反馈连续未变化，早停`,
                );
                break;
            }
        } else {
            stagnationCount = 0;
            previousFeedbackKey = currentFeedbackKey;
        }

        lastFeedback = codeResult.feedback;
    }

    // 降级落盘
    const unconvergedPlan: FunctionPlan = {
        ...lastPlan!,
        unconverged: true,
        lastFeedbackKinds: ["structure"],
        attemptHistory,
    };

    ctx.ctx.info(
        `[compile] 步骤「${node.name}」未收敛（${lastFeedback.length} 条）：${lastFeedback[0] ?? ""}`,
    );
    return { plan: unconvergedPlan, code: lastCode, exceeded: true };
}

// ══════════════════════════════════════════════════════════════════
// 辅助
// ══════════════════════════════════════════════════════════════════

function findMainFlow(ctx: WeaveContext): HumanFlow | null {
    const flows = ctx.conceptManager.listHumanFlows();
    return flows.find((f) => (f as HumanFlow).isMain === true) ?? flows[0] ?? null;
}

function collectPredecessorOutputs(ctx: WeaveContext, flow: HumanFlow, node: FlowNode): string[] {
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