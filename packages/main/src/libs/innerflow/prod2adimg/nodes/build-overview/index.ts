// prod2adimg/nodes/build-overview/index.ts
import { checkExpiry } from "$libs/blueprint/glossary/expiry.js";
import type { IRunnerContext } from "$types/blueprint/context.js";
import { Storage } from "../../storage.js";
import { visualCompositeKey } from "../design-layout/index.js";

export async function buildOverview(ctx: IRunnerContext): Promise<void> {
    const store = new Storage(ctx);

    const report = store.getAudienceReport();
    const cfg = store.getAdConfig();
    const sceneIdxs = report?.scenarios.map(s => s.idx) ?? [];
    const sceneTitles = new Map<number, string>(
        report?.scenarios.map(s => [s.idx, s.title] as const) ?? [],
    );

    const renderResultKeys = cfg.sizes.flatMap(size =>
        sceneIdxs.map(sceneIdx =>
            store.renderResultKey(`ad_${size.key}_${cfg.ad_style}_${sceneIdx}`),
        ),
    );
    const visualKeys = cfg.sizes.flatMap(size =>
        sceneIdxs.map(sceneIdx => store.visualKey(visualCompositeKey(size.key, sceneIdx))),
    );

    if (!checkExpiry(ctx, {
        inputKeys: [
            store.productProfileKey(),
            store.audienceScenariosKey(),
            store.audienceReportKey(),
            store.copywritingKey(),
            ...visualKeys,
            ...renderResultKeys,
        ],
        outputKeys: store.overviewKey(),
    })) {
        ctx.info("[buildOverview] 总览仍新鲜，跳过");
        return;
    }

    const sections: string[] = ["# 商品广告图生成总览"];

    const profile = store.getProductProfile();
    if (profile) sections.push(`## 产品认知\n${profile}`);

    const scenarios = store.getAudienceScenarios();
    if (scenarios) sections.push(`## 人群与触发场景\n${scenarios}`);

    const copy = store.getCopywriting();
    if (copy) sections.push(`## 广告文案\n${copy}`);

    // 拆分为"已渲染"+"待渲染"两个清晰分组
    const rendered: string[] = [];
    const pending: string[] = [];
    let renderedCount = 0;

    for (const size of cfg.sizes) {
        for (const sceneIdx of sceneIdxs) {
            const taskId = `ad_${size.key}_${cfg.ad_style}_${sceneIdx}`;
            const title = sceneTitles.get(sceneIdx) ?? `场景${sceneIdx}`;
            const result = store.getRenderResult(taskId);
            if (result) {
                renderedCount++;
                rendered.push(
                    `- ${size.width}×${size.height}（${size.ratio_label}）｜${title}｜风格 ${cfg.ad_style}`
                    + `｜${result.file_path}（seed=${result.seed}）`,
                );
            } else {
                pending.push(`- ${size.width}×${size.height}（${size.ratio_label}）｜${title}`);
            }
        }
    }

    sections.push(
        `## 已生成广告图\n共 ${renderedCount} 张\n`
        + (rendered.length > 0 ? rendered.join("\n") : "_暂无_"),
    );
    if (pending.length > 0) {
        sections.push(`## 待生成广告图\n${pending.join("\n")}`);
    }

    const overview = sections.join("\n\n---\n\n");
    store.saveOverview(overview);
    ctx.info(`[buildOverview] 总览完成 ${overview.length} 字，已渲染 ${renderedCount}/${cfg.sizes.length * sceneIdxs.length}`);
}