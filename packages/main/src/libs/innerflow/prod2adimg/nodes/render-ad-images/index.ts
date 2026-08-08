// prod2adimg/nodes/render-ad-images/index.ts
import { checkExpiry } from "$libs/blueprint/glossary/expiry.js";
import { configService } from "$libs/store/index.js";
import type { IRunnerContext } from "$types/blueprint/context.js";
import pMap from "p-map";
import { Storage } from "../../storage.js";
import { visualCompositeKey } from "../design-layout/index.js";
import { renderOne } from "./renderer.js";

export async function renderAdImages(ctx: IRunnerContext): Promise<void> {
    const store = new Storage(ctx);

    const report = store.getAudienceReport();
    const cfg = store.getAdConfig();
    if (!report || !report.scenarios.length || !cfg.sizes.length) {
        ctx.info("[renderAdImages] 无场景或无尺寸，跳过");
        return;
    }

    const productImages = store.getProductImages();

    // 任务 = 每尺寸 × 每场景（视觉设计与渲染一对一绑定）
    const tasks = cfg.sizes.flatMap(size =>
        report.scenarios.map(sc => {
            const compositeKey = visualCompositeKey(size.key, sc.idx);
            const taskId = `ad_${size.key}_${cfg.ad_style}_${sc.idx}`;
            return { size, sceneIdx: sc.idx, compositeKey, taskId };
        }),
    );

    let succeeded = 0;
    let failed = 0;
    let skipped = 0;

    await pMap(
        tasks,
        async (task) => {
            if (ctx.isAborted || ctx.isForceKilled) return;

            if (!checkExpiry(ctx, {
                inputKeys: [
                    store.visualKey(task.compositeKey),
                    "productImages",
                    ...store.configKeys(),
                ],
                outputKeys: store.renderResultKey(task.taskId),
            })) {
                skipped++;
                return;
            }

            const visualText = store.getVisual(task.compositeKey);
            if (!visualText) {
                ctx.warn(`[renderAdImages] ${task.compositeKey} 视觉设计缺失，跳过 ${task.taskId}`);
                failed++;
                return;
            }

            const result = await renderOne(ctx, {
                taskId: task.taskId,
                layoutText: visualText,
                size: task.size,
                style: cfg.ad_style,
                sceneIdx: task.sceneIdx,
                productImages,
            });

            if (!result) {
                failed++;
                return;
            }
            store.saveRenderResult(result);
            succeeded++;
        },
        { concurrency: configService().get("concurrency") },
    );

    ctx.info(`[renderAdImages] 完成，成功 ${succeeded}，失败 ${failed}，跳过 ${skipped}`);
}