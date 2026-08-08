// prod2adimg/nodes/design-layout/index.ts
import { checkExpiry } from "$libs/blueprint/glossary/expiry.js";
import { getSmartModel } from "$libs/model/balancer/get-smart-model.js";
import { configService } from "$libs/store/index.js";
import { throwPrecondition } from "$libs/utils/err.js";
import type { IRunnerContext } from "$types/blueprint/context.js";
import { generateText } from "ai";
import pMap from "p-map";
import { Storage } from "../../storage.js";
import { parseCopySets } from "../_shared/parse-copysets.js";
import { VISUAL_DESIGNER_PROMPT } from "./prompts/layout-designer.js";

export function visualCompositeKey(sizeKey: string, sceneIdx: number): string {
    return `${sizeKey}__s${sceneIdx}`;
}

export async function designAdVisuals(ctx: IRunnerContext): Promise<void> {
    const store = new Storage(ctx);

    const copywriting = store.getCopywriting();
    const report = store.getAudienceReport();
    if (!copywriting) throwPrecondition("[designAdVisuals] 缺少文案");
    if (!report || report.scenarios.length === 0) {
        throwPrecondition("[designAdVisuals] 缺少结构化人群场景报告");
    }

    const cfg = store.getAdConfig();
    const copySets = parseCopySets(copywriting);
    const hasProductImage = (await store.getProductImages()).length > 0;
    const productName = cfg.product_name;

    const tasks = cfg.sizes.flatMap(size =>
        report!.scenarios.map((sc) => {
            const compositeKey = visualCompositeKey(size.key, sc.idx);
            return { size, sceneIdx: sc.idx, scenario: sc, compositeKey };
        }),
    );

    await pMap(
        tasks,
        async ({ size, sceneIdx, scenario, compositeKey }) => {
            if (!checkExpiry(ctx, {
                inputKeys: [
                    store.copywritingKey(),
                    store.audienceReportKey(),
                    ...store.configKeys(),
                    "product_name",
                    "product_img",
                ],
                outputKeys: store.visualKey(compositeKey),
            })) {
                ctx.info(`[designAdVisuals] ${compositeKey} 仍新鲜，跳过`);
                return;
            }

            const audience = report!.audiences[scenario.audience_idx];
            if (!audience) {
                ctx.warn(`[designAdVisuals] ${compositeKey} 场景的 audience_idx=${scenario.audience_idx} 无效，跳过`);
                return;
            }
            const audienceProfile = [
                `身份：${audience.label}`,
                `年龄段：${audience.age_range}`,
                `性别：${audience.gender}`,
                `消费能力：${audience.spending}`,
                `聚集地：${audience.region}`,
                `痛点：${audience.pain_point}`,
                `溯源：${audience.derivation}`,
            ].join("\n");
            const copySet = copySets[sceneIdx] ?? copySets[0] ?? "";

            const { text } = await generateText({
                model: getSmartModel(undefined, ctx),
                instructions: VISUAL_DESIGNER_PROMPT.system,
                prompt: VISUAL_DESIGNER_PROMPT.user({
                    width: size.width,
                    height: size.height,
                    ratioLabel: size.ratio_label,
                    scenarioTitle: scenario.title,
                    scenarioDescription: scenario.description,
                    scenarioVisualAnchors: scenario.visual_anchors,
                    scenarioEmotionalHook: scenario.emotional_hook,
                    audienceLabel: audience.label,
                    audienceProfile,
                    productProfile: store.getProductProfile() ?? "",
                    copySet,
                    adStyle: cfg.ad_style,
                    colorScheme: cfg.color_scheme,
                    fontStyle: cfg.font_style,
                    hasProductImage,
                    productName,
                }),
            });

            store.saveVisual(compositeKey, text);
            ctx.info(`[designAdVisuals] ${compositeKey}（${size.key}×${scenario.title}）完成`);
        },
        { concurrency: configService().get("concurrency") },
    );

    ctx.info(`[designAdVisuals] 完成，共 ${tasks.length} 个 (尺寸×场景) 视觉设计（产品图 ${hasProductImage ? "有" : "无"}）`);
}