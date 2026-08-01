/* eslint-disable @typescript-eslint/no-explicit-any */
// nodes/render-images/index.ts
import { checkExpiry } from "$libs/blueprint/glossary/expiry.js";
import type { IRunnerContext } from "$types/blueprint/context.js";
import pMap from "p-map";
import { RefImgStorage } from "../generate-reference-images/storage.js";
import type { RenderTaskDescriptor } from "../generate-reference-images/types.js";
import { planRenderOrder } from "./render-dag.js";
import { renderTask } from "./renderer.js";
import { RenderStorage } from "./storage.js";
import type { RenderResult } from "./types.js";

const P = "#video:";
const MAX_CONCURRENT_RENDER = 8;

export async function renderImages(ctx: IRunnerContext): Promise<void> {
    const refStore = new RefImgStorage(ctx);
    const renderStore = new RenderStorage(ctx);

    const tasks = refStore.getRenderTasks();
    if (!tasks.length) {
        ctx.info("[renderImages] 无渲染任务，跳过");
        return;
    }

    // ===== 依据参考图依赖构建拓扑执行计划 =====
    // 顺序保证：被依赖的参考图（环境图/角色图/制服/群像/提升个体）先出图，
    // 交付帧（scene_shot）后出图，从而其依赖的 file_path 在参数构建时已就绪。
    const { generations, cyclic } = planRenderOrder(tasks);
    if (cyclic) {
        ctx.warn("[renderImages] 检测到循环依赖，降级为单代并行（顺序不保证，请检查任务图构建）");
    }
    ctx.info(`[renderImages] 依赖计划：${generations.length} 代，共 ${tasks.length} 个任务`);

    const byId = new Map<string, RenderTaskDescriptor>(tasks.map(t => [t.id, t]));

    let succeeded = 0;
    let failed = 0;
    let skipped = 0;

    // ===== 按代串行、代内并行 =====
    for (let i = 0; i < generations.length; i++) {
        if (ctx.isAborted || ctx.isForceKilled) {
            ctx.warn(`[renderImages] 第 ${i + 1} 代前检测到终止信号，停止后续渲染`);
            break;
        }

        const genTasks = generations[i]
            .map(id => byId.get(id))
            .filter((t): t is RenderTaskDescriptor => t != null);

        const pending = genTasks.filter(t => !renderStore.getRenderResult(t.id));
        skipped += genTasks.length - pending.length;

        if (!pending.length) continue;

        ctx.info(`[renderImages] 第 ${i + 1}/${generations.length} 代：渲染 ${pending.length} 个任务`);

        await pMap(
            pending,
            async (task) => {
                // renderTask 内部现场构建 generateImage 参数（此时依赖已在前代产出，
                // file_path 可解析）并落盘参数，再调用 callImageAPI。
                const result = await renderTask(ctx, task);
                if (!result) {
                    failed++;
                    return;
                }
                renderStore.saveRenderResult(result);
                succeeded++;
                ctx.info(`[renderImages] ${task.id} 完成：${result.file_path}`);
            },
            { concurrency: MAX_CONCURRENT_RENDER },
        );
    }

    ctx.info(`[renderImages] 渲染结束，成功 ${succeeded}，失败/待实现 ${failed}，已存在跳过 ${skipped}`);

    await buildOverview(ctx, renderStore);
}

async function buildOverview(ctx: IRunnerContext, store: RenderStorage): Promise<void> {
    const refStore = new RefImgStorage(ctx);
    const tasks = refStore.getRenderTasks();
    const renderedIds = store.renderedIds();

    if (!checkExpiry(ctx, {
        inputKeys: tasks.map(t => {
            if (t.type === "scene_environment") return `${P}refimg:env_${t.scene_id}`;
            if (t.type === "uniform_turnaround") return `${P}refimg:uniform_${t.id.replace(/^uniform:/, "")}`;
            if (t.type === "scene_shot" && t.shot_info) {
                return refStore.shotPromptKey(t.shot_info.scene_id, t.shot_info.shot_index);
            }
            const parsed = refStore.parseEntityRefsheetKey(t.id);
            return parsed ? `${P}refimg:entity_${parsed.sceneId}_${parsed.entityName}` : t.id;
        }),
        outputKeys: store.overviewKey(),
    })) {
        ctx.info("[renderImages:overview] 总览仍新鲜，跳过");
        return;
    }

    const sections: string[] = [`# 渲染结果总览（共 ${tasks.length} 个任务，已完成 ${renderedIds.length}）`];

    for (const task of tasks) {
        const result = store.getRenderResult(task.id);
        sections.push(renderTaskSection(task, result));
    }

    const overview = sections.join("\n\n");
    store.saveOverview(overview);
    ctx.info(`[renderImages:overview] 总览完成 ${overview.length}字`);
}

function renderTaskSection(task: any, result: RenderResult | null): string {
    const params = task.reference_images?.length ?? 0;
    const sizing = task.type === "scene_shot" ? "配置横纵比" : "16:9 2K";
    const status = result ? `✓ ${result.file_path}（seed=${result.seed}）` : "✗ 未渲染（参数已备好）";
    const promptPreview = task.prompt.slice(0, 200);
    return [
        `## ${task.id}（${task.type}｜尺寸：${sizing}）`,
        `状态：${status}`,
        `参考图数：${params}`,
        `提示词预览：${promptPreview}${task.prompt.length > 200 ? "..." : ""}`,
    ].join("\n");
}