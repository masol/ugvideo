// prod2adimg/run.ts
import { PrjDB } from "$libs/project/controllers/drizzle/index.js";
import { throwPrecondition } from "$libs/utils/err.js";
import type { IRunnerContext } from "$types/blueprint/context.js";

import { buildOverview } from "./nodes/build-overview/index.js";
import { designLayouts } from "./nodes/design-layout/index.js";
import { designSceneBackgrounds } from "./nodes/design-scene-background/index.js";
import { extractProductProfile } from "./nodes/extract-product-profile/index.js";
import { generateCopywriting } from "./nodes/generate-copywriting/index.js";
import { identifyAudienceAndScenarios } from "./nodes/identify-audience-scenarios/index.js";
import { renderAdImages } from "./nodes/render-ad-images/index.js";
import { Storage } from "./storage.js";

/**
 * target = "x/y"：运行到第 x 步后停止；非此格式则跑完全部。
 */
function parseTargetStep(raw: string | null): number {
    if (!raw) return Infinity;
    const m = raw.match(/^(\d+)\/(\d+)$/);
    if (!m) return Infinity;
    const x = parseInt(m[1], 10);
    const y = parseInt(m[2], 10);
    if (x < 1 || x > y) return Infinity;
    return x;
}

export async function run(ctx: IRunnerContext): Promise<void> {
    const prjdb = PrjDB.ensure(ctx.prj);
    const store = new Storage(ctx);

    // 首次运行落盘默认配置，保证下游 config gate 依赖的 key 存在
    store.ensureDefaultConfig();

    const product = store.getProductInput();
    if (!product.length) {
        throwPrecondition("[prod2adimg] 缺少产品输入 product");
    }

    const targetStep = parseTargetStep(prjdb.get<string>("target"));

    ctx.notify("商品到广告图", "工作流启动");

    // Step 1：产品认知
    await extractProductProfile(ctx);
    await identifyAudienceAndScenarios(ctx);
    if (targetStep <= 1) { ctx.notify("已停止", "产品解析完成"); return; }

    // Step 2：文案生成
    await generateCopywriting(ctx);
    if (targetStep <= 2) { ctx.notify("已停止", "文案生成完成"); return; }

    // Step 3：视觉设计（场景背景 + 布局）
    await designSceneBackgrounds(ctx);
    if (targetStep <= 3) { ctx.notify("已停止", "场景设计完成"); return; }

    await designLayouts(ctx);
    if (targetStep <= 4) { ctx.notify("已停止", "布局设计完成"); return; }

    // Step 5：参考图 / 渲染 prompt（若拆分则在此；本设计并入渲染节点组装 prompt）
    // Step 6：图片渲染
    await renderAdImages(ctx);
    if (targetStep <= 6) { ctx.notify("已停止", "图片渲染完成"); return; }

    // Step 7：广告图合成总览
    await buildOverview(ctx);

    ctx.notify("完成", "广告图全流程已跑完");
}