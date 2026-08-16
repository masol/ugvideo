/**
 * weaver · node ④ generate-instructions
 *
 * v6 变更：
 * - KV key 改为 <nodeId>:<instructionId>（保证全局唯一，无覆盖风险）
 * - index 值存 <nodeId>:<instructionId> 组合
 */

import { checkExpiry } from "$libs/blueprint/glossary/expiry.js";
import { configService } from "$libs/store/index.js";
import pMap from "p-map";
import type { WeaveContext } from "../../context.js";
import type { ArtifactRelation, HumanNode } from "../../types.js";
import { generateInstruction } from "./prompt-generator.js";

export async function generateInstructions(ctx: WeaveContext): Promise<void> {
    const store = ctx.storage.workflow;

    if (!checkExpiry(ctx.ctx, {
        inputKeys: store.latestKey("function_plan_index"),
        outputKeys: store.latestKey("gi_index"),
    })) {
        ctx.ctx.info("[generateInstructions] 输出仍新鲜，跳过");
        return;
    }

    const nodeIds = store.getFunctionPlanIndex();
    if (!nodeIds || nodeIds.length === 0) {
        ctx.ctx.notify("generate-instructions", "无节点需要处理，跳过");
        store.saveGeneratedInstructionsIndex([]);
        return;
    }

    ctx.ctx.notify("generate-instructions", `开始为 ${nodeIds.length} 个节点生成提示词`);

    const flowIntent = getMainFlowIntent(ctx);
    const relations = store.getArtifactRelations() ?? {};

    // ── 1. 收集所有需要生成的 instruction ──
    const instructionContexts = new Map<string, InstructionGenContext>();

    for (const nodeId of nodeIds) {
        const plan = store.getFunctionPlan(nodeId);
        if (!plan) continue;

        const node = ctx.conceptManager.nodes.get(nodeId) as HumanNode | null;
        const rawInputIds = node?.inputs ?? [];
        const rawOutputIds = node?.outputs ?? [];

        const nodeInputs = rawInputIds.map((id) => {
            const a = ctx.conceptManager.artifacts.get(id);
            return a ? a.name : id;
        });
        const nodeOutputs = rawOutputIds.map((id) => {
            const a = ctx.conceptManager.artifacts.get(id);
            return a ? a.name : id;
        });

        for (const inst of plan.instructions) {
            if (!inst.id) continue;
            // key = nodeId:instructionId（全局唯一）
            const compositeKey = `${nodeId}:${inst.id}`;
            if (!instructionContexts.has(compositeKey)) {
                instructionContexts.set(compositeKey, {
                    compositeKey,
                    id: inst.id,
                    nodeId,
                    nodeName: plan.sourceNodeName,
                    existingHint: inst.content ?? "",
                    nodeInputs,
                    nodeOutputs,
                    nodeAction: node?.actionAtom ?? "",
                    apiKind: plan.apiKind,
                    allInstructionsInNode: plan.instructions.map((i) => ({
                        id: i.id,
                        content: i.content,
                    })),
                    flowIntent,
                    inputSemantics: buildArtifactSemantics(ctx, rawInputIds),
                    outputSemantics: buildArtifactSemantics(ctx, rawOutputIds),
                    inputRelations: buildArtifactRelationsInfo(ctx, rawInputIds, relations),
                    outputRelations: buildArtifactRelationsInfo(ctx, rawOutputIds, relations),
                });
            }
        }
    }

    if (instructionContexts.size === 0) {
        ctx.ctx.notify("generate-instructions", "无需生成新提示词");
        store.saveGeneratedInstructionsIndex([]);
        return;
    }

    ctx.ctx.notify(
        "generate-instructions",
        `共 ${instructionContexts.size} 个 instruction 需要生成`,
    );

    // ── 2. 并行生成 ──
    const concurrency = Math.max(configService().get("concurrency") || 4, 2);
    const completedKeys: string[] = [];

    await pMap(
        [...instructionContexts.values()],
        async (ictx) => {
            const content = await generateInstruction(ctx, ictx);
            store.saveGeneratedInstruction(ictx.compositeKey, content);
            completedKeys.push(ictx.compositeKey);
            ctx.ctx.info(
                `[generateInstructions] 已生成「${ictx.compositeKey}」(${content.length} 字)`,
            );
        },
        { concurrency, stopOnError: false },
    );

    // ── 3. 落盘 index ──
    store.saveGeneratedInstructionsIndex(completedKeys);
    ctx.ctx.notify(
        "generate-instructions 完成",
        `已为 ${completedKeys.length} 个 instruction 生成提示词`,
    );
}

// ══════════════════════════════════════════════════════════════════
// 上游信息提取
// ══════════════════════════════════════════════════════════════════

function getMainFlowIntent(ctx: WeaveContext): string {
    const flows = ctx.conceptManager.listHumanFlows();
    const mainFlow = flows.find((f) => f.isMain === true) ?? flows[0];
    return mainFlow?.intent ?? "";
}

function buildArtifactSemantics(
    ctx: WeaveContext,
    artifactIds: string[],
): { name: string; role: string }[] {
    const out: { name: string; role: string }[] = [];
    for (const id of artifactIds) {
        const a = ctx.conceptManager.artifacts.get(id);
        if (!a) continue;
        out.push({
            name: a.name,
            role: a.intent && a.intent !== a.name ? a.intent : "",
        });
    }
    return out;
}

function buildArtifactRelationsInfo(
    ctx: WeaveContext,
    artifactIds: string[],
    relations: Record<string, ArtifactRelation>,
): { name: string; relationText: string }[] {
    const out: { name: string; relationText: string }[] = [];
    for (const id of artifactIds) {
        const a = ctx.conceptManager.artifacts.get(id);
        if (!a) continue;
        const rel = relations[a.name];
        if (!rel) continue;
        const parts: string[] = [];
        if (rel.partOf && rel.partOf.length > 0) {
            parts.push(`partOf: [${rel.partOf.join(", ")}]`);
        }
        if (rel.composedOf && rel.composedOf.length > 0) {
            parts.push(`composedOf: [${rel.composedOf.join(", ")}]`);
        }
        if (rel.refinedFrom && rel.refinedFrom.length > 0) {
            parts.push(`refinedFrom: [${rel.refinedFrom.join(", ")}]`);
        }
        if (rel.derivedFrom && rel.derivedFrom.length > 0) {
            parts.push(`derivedFrom: [${rel.derivedFrom.join(", ")}]`);
        }
        if (rel.arrayOf) {
            parts.push(`arrayOf: ${rel.arrayOf}`);
        }
        if (parts.length > 0) {
            out.push({ name: a.name, relationText: parts.join("；") });
        }
    }
    return out;
}

export interface InstructionGenContext {
    compositeKey: string;
    id: string;
    nodeId: string;
    nodeName: string;
    existingHint: string;
    nodeInputs: string[];
    nodeOutputs: string[];
    nodeAction: string;
    apiKind: string;
    allInstructionsInNode: { id: string; content: string }[];
    flowIntent: string;
    inputSemantics: { name: string; role: string }[];
    outputSemantics: { name: string; role: string }[];
    inputRelations: { name: string; relationText: string }[];
    outputRelations: { name: string; relationText: string }[];
}