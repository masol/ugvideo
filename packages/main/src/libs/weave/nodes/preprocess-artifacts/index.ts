/**
 * weaver · node ② preprocess-artifacts
 *
 * v5：三层兜底 + messages history 回灌
 */

import { checkExpiry } from "$libs/blueprint/glossary/expiry.js";
import type { ModelMessage } from "ai";
import type { WeaveContext } from "../../context.js";
import type {
    Artifact,
    ArtifactLineageMap,
    ArtifactRelation,
    HumanFlow,
} from "../../types.js";
import type { FrozenNamesConstraint } from "../parse/parse-types.js";
import { reconcileWithFuse, reconcileWithStandardDoc } from "./artifact-reconcile.js";
import {
    blockingIssues,
    formatIssueFeedback,
    validateRelations,
} from "./artifact-report.js";
import { exportLineageJSON, exportLineageMarkdown } from "./export-lineage.js";
import {
    buildLineage,
    inferStaticRelations,
    mergeStaticIntoArtifacts,
    type StaticInference,
} from "./infer-static.js";
import { refineRelationsByLLM } from "./refine-llm.js";

export interface PreprocessOutcome {
    success: boolean;
    requiresParseRerun?: {
        frozenNames: FrozenNamesConstraint;
        feedback: string[];
    };
    relations?: Record<string, ArtifactRelation>;
    lineage?: ArtifactLineageMap;
}

export async function preprocessArtifacts(
    ctx: WeaveContext,
): Promise<PreprocessOutcome> {
    const store = ctx.storage.workflow;

    if (!checkExpiry(ctx.ctx, {
        inputKeys: store.latestKey("parsed_docs_index"),
        outputKeys: store.latestKey("artifact_relations"),
    })) {
        ctx.ctx.info("[preprocessArtifacts] 输出仍新鲜，跳过");
        return { success: true };
    }

    const mainFlow = findMainFlow(ctx);
    if (!mainFlow) {
        ctx.ctx.notify("preprocess", "无主工作流，跳过");
        return { success: true };
    }

    let artifacts = ctx.conceptManager.artifacts.list() as Artifact[];

    ctx.ctx.notify("preprocess", `开始整理 ${artifacts.length} 个 artifact 的关系`);

    // ══════════════════════════════════════════════════════════════
    // 第 1 层兜底：fuse.js 自动归一化（cost=0）
    // ══════════════════════════════════════════════════════════════
    const fuseResult = reconcileWithFuse(ctx, mainFlow);
    if (fuseResult.changed) {
        ctx.ctx.info(
            `[preprocessArtifacts] 第 1 层 fuse归一化完成：${Object.keys(fuseResult.renameMap).length} 个改名`,
        );
        artifacts = ctx.conceptManager.artifacts.list() as Artifact[];
    }

    // ══════════════════════════════════════════════════════════════
    // 第 2 层兜底：基于 standard_doc 重建（cost=低）
    // ══════════════════════════════════════════════════════════════
    if (
        fuseResult.remainingDuplicateProducers.length > 0 ||
        fuseResult.remainingOrphans.length > 0
    ) {
        const standardResult = await reconcileWithStandardDoc(ctx, mainFlow, 0);
        if (standardResult.changed) {
            ctx.ctx.info(
                `[preprocessArtifacts] 第 2 层 standard_doc 重建完成：${Object.keys(standardResult.renameMap).length} 个改名`,
            );
            artifacts = ctx.conceptManager.artifacts.list() as Artifact[];

            fuseResult.remainingDuplicateProducers = standardResult.remainingDuplicateProducers;
            fuseResult.remainingOrphans = standardResult.remainingOrphans;
        }
    }

    // ══════════════════════════════════════════════════════════════
    // 第 3 层兜底：触发 parse 重跑（仅在第 1 + 第 2 层都失败时）
    // ══════════════════════════════════════════════════════════════
    if (
        fuseResult.remainingDuplicateProducers.length > 0 ||
        fuseResult.remainingOrphans.length > 0
    ) {
        const frozenNames = buildFrozenNamesFromArtifacts(artifacts);
        const feedback = [
            ...fuseResult.remainingDuplicateProducers.map((n) => `产物「${n}」被多个节点产出`),
            ...fuseResult.remainingOrphans.map((n) => `产物「${n}」被消费但无 producer`),
        ];
        ctx.ctx.notify(
            "preprocess 要求 parse 重跑",
            `第 1+2 层兜底失败，触发 parse 重跑`,
        );
        return {
            success: false,
            requiresParseRerun: { frozenNames, feedback },
        };
    }

    // ── 静态推导 ──
    const staticInf: StaticInference = inferStaticRelations(ctx, mainFlow);
    mergeStaticIntoArtifacts(artifacts, staticInf);

    ctx.ctx.info(
        `[preprocessArtifacts] 静态推导完成：` +
        `refinedFrom 线索 ${staticInf.refinedFrom.size} 条，` +
        `arrayOf 线索 ${staticInf.arrayOf.size} 条`,
    );

    // ── 多轮 LLM 补全 + 校验 ──
    const maxRounds = ctx.storage.config.getMaxReactRounds();
    let relations: Record<string, ArtifactRelation> = {};
    let lineage: ArtifactLineageMap = { byArtifact: {}, finalLineage: [] };
    let messages: ModelMessage[] | undefined = undefined;
    let lastFeedback: string[] = [];

    for (let round = 0; round < maxRounds; round++) {
        ctx.ctx.notify(
            "preprocess",
            `第 ${round + 1}/${maxRounds} 轮：LLM 补全${lastFeedback.length > 0 ? `（含 ${lastFeedback.length} 条反馈）` : ""}`,
        );

        const result = await refineRelationsByLLM(
            ctx,
            mainFlow,
            artifacts.map((a) => a.name),
            {
                refinedFrom: Object.fromEntries(staticInf.refinedFrom),
                arrayOf: Object.fromEntries(staticInf.arrayOf),
            },
            messages,
            lastFeedback.length > 0 ? lastFeedback : undefined,
        );
        messages = result.messages;
        const llmRelations = result.relations;

        // ── 合并 ──
        relations = {};
        for (const a of artifacts) {
            const staticR = a.relations ?? {};
            const llmR = llmRelations[a.name] ?? {};

            const merged: ArtifactRelation = { ...staticR, ...llmR };
            const mergeArr = (s?: string[], l?: string[]): string[] | undefined => {
                const set = new Set<string>();
                for (const x of s ?? []) set.add(x);
                for (const x of l ?? []) set.add(x);
                const out = [...set];
                return out.length > 0 ? out : undefined;
            };
            merged.partOf = mergeArr(staticR.partOf, llmR.partOf);
            merged.composedOf = mergeArr(staticR.composedOf, llmR.composedOf);
            merged.refinedFrom = mergeArr(staticR.refinedFrom, llmR.refinedFrom);
            merged.derivedFrom = mergeArr(staticR.derivedFrom, llmR.derivedFrom);

            relations[a.name] = merged;
            a.relations = merged;
        }

        lineage = buildLineage(ctx, mainFlow);

        const issues = validateRelations(ctx, mainFlow, relations, lineage);
        const blocking = blockingIssues(issues);

        if (blocking.length === 0) {
            ctx.ctx.info(
                `[preprocessArtifacts] 第 ${round + 1} 轮校验通过` +
                (issues.length > 0 ? `（含 ${issues.length} 条 warning）` : ""),
            );
            break;
        }

        // dangling-reference：关系引用了不存在的产物
        const hasDangling = blocking.some((b) => b.kind === "dangling-reference");
        if (hasDangling) {
            const frozenNames = buildFrozenNamesFromArtifacts(artifacts);
            const fb = blocking
                .filter((b) => b.kind === "dangling-reference")
                .map((b) => b.message);

            ctx.ctx.notify(
                "preprocess 要求 parse 重跑",
                `检测到 dangling-reference，触发 parse 重跑`,
            );

            return {
                success: false,
                requiresParseRerun: { frozenNames, feedback: fb },
            };
        }

        lastFeedback = formatIssueFeedback(blocking);
        ctx.ctx.notify(
            "preprocess",
            `第 ${round + 1} 轮：${blocking.length} 条 error 反馈重试`,
        );

        if (round === maxRounds - 1) {
            ctx.ctx.info(
                `[preprocessArtifacts] 经 ${maxRounds} 轮仍未通过校验，落盘当前结果：` +
                blocking.map((b) => b.message).join("；"),
            );
        }
    }

    // ── 落盘 ──
    store.saveArtifactRelations(relations);
    store.saveArtifactLineage(lineage);

    const lineageMd = exportLineageMarkdown(relations, lineage, mainFlow.name);
    store.saveLineageDoc(lineageMd);

    const lineageJson = exportLineageJSON(relations, lineage, mainFlow.name);
    store.saveLineageSnapshot(lineageJson);

    ctx.ctx.notify(
        "preprocess 完成",
        `${Object.keys(relations).length} 个 artifact 的关系已整理` +
        (lineage.finalLineage.length > 0
            ? `；lineage 主链 ${lineage.finalLineage.length} 节点`
            : ""),
    );

    return { success: true, relations, lineage };
}

function buildFrozenNamesFromArtifacts(
    artifacts: Artifact[],
): FrozenNamesConstraint {
    const names: string[] = [];
    const hints: Record<string, string> = {};

    for (const a of artifacts) {
        names.push(a.name);
        const r = a.relations;
        if (r?.composedOf && r.composedOf.length > 0) {
            hints[a.name] = `由 [${r.composedOf.join(", ")}] 拼装而成`;
        } else if (r?.refinedFrom && r.refinedFrom.length > 0) {
            hints[a.name] = `由 [${r.refinedFrom.join(", ")}] 提炼而来`;
        } else if (a.intent && a.intent !== a.name) {
            hints[a.name] = a.intent.slice(0, 50);
        } else {
            hints[a.name] = "工作流产物";
        }
    }

    return { names, hints };
}

function findMainFlow(ctx: WeaveContext): HumanFlow | null {
    const flows = ctx.conceptManager.listHumanFlows();
    return flows.find((f) => f.isMain === true) ?? flows[0] ?? null;
}