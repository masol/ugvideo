/**
 * weaver · preprocess-artifacts · DAG 反向调整
 *
 * 关键变更（v2）：
 *   - 完全移除"自动改名 _v2 / _v3"机制——凭空造名是噪声；
 *   - duplicate-producer 不再尝试修复，直接报错要求 parse 重跑；
 *   - orphan-artifact：先调 LLM 分类；
 *     - 若应为输入 → 添加到 flow.inputs；
 *     - 若应有节点产出 → 标记为 error（需用户补全原始文档），不自动生成节点。
 */

import type { WeaveContext } from "../../context.js";
import { validateHumanFlow } from "../../graph/validate.js";
import type {
    FlowGraph,
    HumanFlow
} from "../../types.js";
import type { RelationIssue } from "./artifact-report.js";
import { classifyOrphanArtifacts } from "./llm-classify.js";

export interface DagRepairResult {
    repaired: boolean;
    repairedFlow: HumanFlow | null;
    summary: string;
    /** DAG 修复后，应触发 parse 重跑？ */
    requiresParseRerun: boolean;
}

export async function repairDagIfNeeded(
    ctx: WeaveContext,
    flow: HumanFlow,
    issues: RelationIssue[],
): Promise<DagRepairResult> {
    const duplicates = issues.filter((i) => i.kind === "duplicate-producer" && i.artifactName);
    const orphans = issues.filter((i) => i.kind === "orphan-artifact" && i.artifactName);

    // duplicate-producer 永远不自动修——强制 parse 重跑
    if (duplicates.length > 0) {
        return {
            repaired: false,
            repairedFlow: null,
            summary: duplicates.map((d) => d.message).join("；"),
            requiresParseRerun: true,
        };
    }

    if (orphans.length === 0) {
        return { repaired: false, repairedFlow: null, summary: "无需 DAG 调整", requiresParseRerun: false };
    }

    const workingFlow = cloneFlow(ctx, flow);
    const repairLog: string[] = [];

    const orphanNames = orphans.map((o) => o.artifactName!);
    const classification = await classifyOrphanArtifacts(ctx, workingFlow, orphanNames);

    for (const name of classification.shouldBeInputs) {
        if (!workingFlow.inputs.includes(name)) {
            workingFlow.inputs.push(name);
            repairLog.push(`孤儿产物「${name}」归类为外部输入，已添加到工作流输入`);
        }
    }

    for (const name of classification.shouldHaveProducer) {
        repairLog.push(
            `孤儿产物「${name}」应有节点产出但缺失，需用户手动补全原始文档。`,
        );
    }

    // 重跑 DAG 校验
    const validationErrors = validateHumanFlow(
        workingFlow,
        ctx.conceptManager,
        ctx.storage.config.getMaxPathsPerNode(),
    );
    const blocking = validationErrors.filter((e) => e.severity === "error");
    if (blocking.length > 0) {
        ctx.ctx.info?.(
            `[dag-repair] 调整后 DAG 仍有 error 级问题：${blocking.map((b) => b.message).join("；")}`,
        );
        return { repaired: false, repairedFlow: null, summary: repairLog.join("；"), requiresParseRerun: false };
    }

    replaceMainFlow(ctx, workingFlow);
    return { repaired: true, repairedFlow: workingFlow, summary: repairLog.join("；"), requiresParseRerun: false };
}

function cloneFlow(_ctx: WeaveContext, flow: HumanFlow): HumanFlow {
    const newG = flow.g.copy();
    return { ...flow, g: newG };
}

function replaceMainFlow(ctx: WeaveContext, newFlow: HumanFlow): void {
    const oldId = ctx.conceptManager.entryGraphId;
    if (oldId) ctx.conceptManager.graphs.clearById(oldId);
    (newFlow as FlowGraph).isMain = true;
    ctx.conceptManager.graphs.register(newFlow);
    ctx.conceptManager.setEntryGraph(newFlow.id);
}