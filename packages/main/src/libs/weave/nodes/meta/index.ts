/**
 * weaver · node ⑤ meta · 编排入口
 *
 * v8 变更：
 * - collectMainInputs：遍历主工作流所有非配置输入（不只是第一个），
 *   传给 buildActivities 用于 input-manager 的多 text-list 绑定。
 */

import { checkExpiry } from "$libs/blueprint/glossary/expiry.js";
import { throwUnprcessable } from "$libs/utils/err.js";
import { projectActivityDataSchema } from "$types/shared/template/project.js";
import { randomUUID } from "crypto";
import type { WeaveContext } from "../../context.js";
import type { Artifact, HumanFlow, HumanNode } from "../../types.js";
import { buildActivities } from "./activities.js";
import { buildMetaJson, buildTypeJson } from "./assemble.js";
import { generateCopywriting } from "./copywriting.js";
import { buildBlueprintFilters } from "./filters.js";
import { resolveIcons } from "./icons.js";
import { buildSafeNameMap, extractConfigItems } from "./safe-names.js";
import { topologicalLevels } from "./topo-levels.js";

export async function metaWorkflow(ctx: WeaveContext): Promise<void> {
    const store = ctx.storage.workflow;

    if (!checkExpiry(ctx.ctx, {
        inputKeys: store.latestKey("gi_index"),
        outputKeys: store.latestKey("meta_json"),
    })) {
        ctx.ctx.info("[meta] 输出仍新鲜，跳过");
        return;
    }

    const mainFlow = findMainFlow(ctx);
    if (!mainFlow) {
        ctx.ctx.notify("meta", "无主工作流，跳过");
        return;
    }

    ctx.ctx.notify("meta", "开始生成 UI 描述与映射表");

    const stableId = ensureStableId(store);
    const levels = topologicalLevels(mainFlow.g);
    ctx.ctx.info(`[meta] 主 DAG 分 ${levels.length} 代`);

    const safeNameMap = buildSafeNameMap(store, mainFlow);
    store.saveSafeNameMap(safeNameMap);

    const dagNodes = collectMainFlowNodes(ctx, mainFlow);
    const mainInputs = collectMainInputs(ctx, mainFlow);
    const configItems = extractConfigItems(store, safeNameMap);

    const iconSlots = buildIconSlots(mainFlow, levels);

    const [copywriting, resolvedIcons] = await Promise.all([
        generateCopywriting(ctx, mainFlow, dagNodes, levels, mainInputs),
        resolveIcons(ctx, mainFlow, iconSlots),
    ]);

    const lineage = store.getArtifactLineage() ?? { byArtifact: {}, finalLineage: [] };

    const metaJson = buildMetaJson({
        stableId,
        name: copywriting.workflowName,
        description: copywriting.workflowDesc,
        icon: resolvedIcons.meta_icon || "IconCircle",
    });

    const checkInputKey = mainInputs.length > 0
        ? `#${mainInputs[mainInputs.length - 1].name}`
        : null;

    const typeJson = buildTypeJson({
        flowName: copywriting.workflowName,
        flowDesc: copywriting.workflowDesc,
        icon: resolvedIcons.meta_icon || "IconCircle",
        idleHint: copywriting.idleHint,
        checkInputTitle: copywriting.checkInputTitle,
        checkInputDesc: copywriting.checkInputDesc,
        checkInputKey,
        targets: levels.map((_, i) => ({
            label: copywriting.targetLabels[i] ?? `第 ${i + 1} 阶段`,
            desc: copywriting.targetDescs[i] ?? "",
            icon: resolvedIcons[`target_${i}`] || "IconCircle",
        })),
        activities: buildActivities(copywriting, resolvedIcons, mainInputs, configItems),
        blueprintFilters: buildBlueprintFilters(levels, lineage),
    });

    const parseResult = projectActivityDataSchema.safeParse(typeJson);
    if (!parseResult.success) {
        ctx.ctx.info(
            `[meta] type.json Zod 校验失败：${parseResult.error.issues.map(i => i.message).join("；")}`,
        );
        throwUnprcessable(
            `[meta] type.json 结构不合法：${parseResult.error.issues.length} 条错误`,
        );
    }

    store.saveMetaJson(JSON.stringify(metaJson, null, 2));
    store.saveTypeJson(JSON.stringify(typeJson, null, 2));

    ctx.ctx.notify("meta 完成", `stableId=${stableId.slice(0, 8)}…，配置项 ${configItems.length} 条`);
}

function findMainFlow(ctx: WeaveContext): HumanFlow | null {
    const flows = ctx.conceptManager.listHumanFlows();
    return flows.find((f) => f.isMain === true) ?? flows[0] ?? null;
}

function collectMainFlowNodes(ctx: WeaveContext, flow: HumanFlow): HumanNode[] {
    const out: HumanNode[] = [];
    flow.g.forEachNode((id) => {
        const n = ctx.conceptManager.nodes.get(id);
        if (n && n.kind === "human") out.push(n as HumanNode);
    });
    return out;
}

/**
 * 收集主工作流的所有非配置输入——这些是入口处需要用户提供的外部材料。
 * Config（带默认值的固定素材）归 spec-setting 段处理，不在此处出现。
 */
function collectMainInputs(ctx: WeaveContext, flow: HumanFlow): MainInputArtifact[] {
    const out: MainInputArtifact[] = [];
    for (const inputId of flow.inputs) {
        const a = ctx.conceptManager.artifacts.get(inputId);
        const isConfig = (a as Artifact & { isConfig?: boolean })?.isConfig === true;
        if (a && isConfig) continue;
        out.push({
            name: a?.name ?? inputId,
            intent: a?.intent ?? "",
        });
    }
    return out;
}

export interface MainInputArtifact {
    name: string;
    intent: string;
}

export interface ConfigItem {
    originalKey: string;
    safeKey: string;
    label: string;
    defaultValue: string;
}

export interface IconSlot {
    slotId: string;
    semantic: string;
}

function buildIconSlots(flow: HumanFlow, levels: string[][]): IconSlot[] {
    const slots: IconSlot[] = [];
    slots.push({ slotId: "meta_icon", semantic: `工作流整体图标：${flow.intent}` });
    for (let i = 0; i < levels.length; i++) {
        slots.push({ slotId: `target_${i}`, semantic: `第 ${i + 1} 代步骤（${levels[i].join("、")}）` });
    }
    slots.push({ slotId: "input_section", semantic: "输入管理区块" });
    slots.push({ slotId: "config_section", semantic: "配置区块" });
    slots.push({ slotId: "script_list", semantic: "工作流描述列表" });
    return slots;
}

function ensureStableId(store: import("../../storage/workflow.js").WorkflowStorage): string {
    const existing = store.getStableMetaId();
    if (existing) return existing;
    const id = randomUUID();
    store.saveStableMetaId(id);
    return id;
}