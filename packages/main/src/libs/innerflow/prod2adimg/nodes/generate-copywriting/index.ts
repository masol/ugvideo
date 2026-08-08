// prod2adimg/nodes/generate-copywriting/index.ts
import { checkExpiry } from "$libs/blueprint/glossary/expiry.js";
import { getSmartModel } from "$libs/model/balancer/get-smart-model.js";
import { throwPrecondition } from "$libs/utils/err.js";
import type { IRunnerContext } from "$types/blueprint/context.js";
import { generateText } from "ai";
import { Storage } from "../../storage.js";
import type { AudienceScenarioReport } from "../../types.js";
import { COPYWRITER_PROMPT } from "./prompts/copywriter.js";

export async function generateCopywriting(ctx: IRunnerContext): Promise<void> {
    const store = new Storage(ctx);

    if (!checkExpiry(ctx, {
        inputKeys: [
            store.productProfileKey(),
            store.audienceScenariosKey(),
            store.audienceReportKey(),
            "product_name",
            "selling_points",
            "promo_text",
        ],
        outputKeys: store.copywritingKey(),
    })) {
        ctx.info("[generateCopywriting] 文案仍新鲜，跳过");
        return;
    }

    const profile = store.getProductProfile();
    const scenariosNL = store.getAudienceScenarios();
    const report = store.getAudienceReport();
    if (!profile || !scenariosNL || !report) {
        throwPrecondition("[generateCopywriting] 缺少产品事实/人群场景/结构化报告");
    }

    const reportBlock = renderReport(report!);
    const productName = store.getProductName();
    const sellingPoints = store.getSellingPoints();
    const promoText = store.getPromoText();

    const userBlock: string[] = [];
    if (productName) userBlock.push(`**产品名称（必须出现在主标题或副标题中）**：${productName}`);
    if (sellingPoints.length) userBlock.push(`**用户确认的核心卖点（必须按优先级出现在文案套中）**：${sellingPoints.join(" / ")}`);
    if (promoText) userBlock.push(`**用户确认的促销信息（必须出现在促销信息栏）**：${promoText}`);
    const userContext = userBlock.length ? `\n\n## 用户已确认的信息（最高优先级）\n${userBlock.join("\n")}` : "";

    const { text } = await generateText({
        model: getSmartModel(undefined, ctx),
        instructions: COPYWRITER_PROMPT.system,
        prompt: COPYWRITER_PROMPT.user(profile!, reportBlock) + userContext,
    });

    store.saveCopywriting(text);
    ctx.info(`[generateCopywriting] 完成，文案 ${text.length} 字${userContext ? "（含用户确认信息）" : ""}`);
}

function renderReport(report: AudienceScenarioReport): string {
    const lines: string[] = [];
    lines.push("## 人群");
    report.audiences.forEach((a, i) => {
        lines.push(`- 人群 ${i}: ${a.label} | ${a.age_range} | ${a.gender} | ${a.spending} | ${a.region} | 痛点：${a.pain_point}`);
    });
    lines.push("");
    lines.push("## 场景");
    report.scenarios.forEach((s) => {
        const a = report.audiences[s.audience_idx];
        lines.push(`- 场景 ${s.idx}: ${s.title}（人群：${a?.label ?? "?"}）`);
        lines.push(`  - 描述：${s.description}`);
        lines.push(`  - 视觉锚点：${s.visual_anchors}`);
        lines.push(`  - 情感诉求：${s.emotional_hook}`);
    });
    return lines.join("\n");
}