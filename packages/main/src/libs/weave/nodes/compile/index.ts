/**
 * weaver · node ③ compile
 *
 * 职责：把每个 HumanNode 的 actionAtom + 全局上下文编译为 TS 伪代码。
 * reAct 主收敛：messages 累积 + 两类校验反馈（语义等价 + 伪代码一致性）。
 *
 * 变更（v2）：
 * - 分离存储：function_plan（元信息）+ function_code（TS 代码）
 * - 删除冗余：relations 不再传递到 compile 阶段
 *
 * 缓存策略：
 *   - 顶层门控：function_plan_index 存在且 artifact_relations 未变 → 跳过整个 compile
 *   - 逐节点缓存：仅当 function_plan_index 已存在（上次全量成功）时才生效
 *   - function_plan_index 只在所有节点都在 maxRounds 内通过校验后才写入
 *   - 任何节点超出 maxRounds → 不写 function_plan_index → 下次重跑时全部重算
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
import type { FunctionPlan } from "./parse-types.js";
import { renderPlanMarkdown } from "./render-plan-inline.js";
import { verifyFunctionPlan } from "./verify-dag.js";
import { verifySemanticEquivalence } from "./verify-semantic.js";

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

    ctx.ctx.notify("compile", `开始编译 ${allNodes.length} 个步骤（全节点并发）`);

    const maxRounds = ctx.storage.config.getMaxReactRounds();
    const concurrency = Math.max(configService().get("concurrency") || 4, 2);
    const prevIndexExists = store.getFunctionPlanIndex() != null;

    const nodeIds: string[] = [];
    let anyExceeded = false;

    // 全节点并发（compile 阶段不依赖前驱节点的 FunctionPlan）
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
        if (exceeded) anyExceeded = true;
    }, { concurrency });

    if (anyExceeded) {
        ctx.ctx.notify(
            "compile 完成（含超时节点）",
            `${nodeIds.length} 个步骤已编译，但部分节点超出轮次限制，下次将重算`,
        );
    } else {
        store.saveFunctionPlanIndex(nodeIds);
        ctx.ctx.notify("compile 完成", `${nodeIds.length} 个步骤已编译为 Execution Plan`);
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

    // 逐节点缓存：仅当上次全量成功时才信任缓存
    if (prevIndexExists) {
        const planKey = store.latestKey(`function_plan:${node.id}`);
        const codeKey = store.latestKey(`function_code:${node.id}`);
        if (!checkExpiry(ctx.ctx, {
            inputKeys: store.latestKey("artifact_relations"),
            outputKeys: [planKey, codeKey],
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

        // ── 多验证器：语义等价 + 伪代码一致性 ──
        const planMd = renderPlanMarkdown(result.plan, result.code);
        const semanticFb = await verifySemanticEquivalence(ctx, node.actionAtom, planMd);
        const codeResult = verifyFunctionPlan(result.plan, result.code, node.inputs, node.outputs);

        const blockingFeedback = [...semanticFb, ...codeResult.feedback];

        if (blockingFeedback.length === 0) {
            ctx.ctx.info(`[compile] 步骤「${node.name}」第 ${round + 1} 轮校验通过`);
            return { plan: result.plan, code: result.code, exceeded: false };
        }

        lastFeedback = blockingFeedback;
        ctx.ctx.info(
            `[compile] 步骤「${node.name}」第 ${round + 1} 轮：${blockingFeedback.length} 条阻断反馈`,
        );
    }

    ctx.ctx.info(
        `[compile] 步骤「${node.name}」经 ${maxRounds} 轮仍有反馈，落盘当前结果`,
    );
    return { plan: lastPlan!, code: lastCode, exceeded: true };
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