// prod2adimg/nodes/identify-audience-scenarios/index.ts
import { checkExpiry } from "$libs/blueprint/glossary/expiry.js";
import { getSmartModel } from "$libs/model/balancer/get-smart-model.js";
import { safefmt } from "$libs/model/llm/outline.js";
import { throwPrecondition, throwUnprcessable } from "$libs/utils/err.js";
import type { IRunnerContext } from "$types/blueprint/context.js";
import { generateText, Output } from "ai";
import { getErrorMessage } from "radashi";
import { z } from "zod";
import { Storage } from "../../storage.js";
import {
    AUDIENCE_CRITIQUE_PROMPT,
    AUDIENCE_FUSION_PROMPT,
    AUDIENCE_GENERATOR_PROMPT,
} from "./prompts/audience-analyzer.js";

const MAX_ROUNDS = 3;

const AudienceProfileSchema = z.object({
    label: z.string().describe("一句话身份命名，如'风水勘舆师'"),
    age_range: z.string().describe("年龄段"),
    gender: z.enum(["male", "female", "mixed"]).describe("性别倾向"),
    spending: z.enum(["low", "mid", "mid_high", "high"]).describe("消费能力"),
    region: z.string().describe("主要聚集地"),
    pain_point: z.string().describe("该人群典型痛点"),
    derivation: z.string().describe("从产品哪个功能或修饰词推导而来"),
});

const TriggerScenarioSchema = z.object({
    idx: z.number().int().min(0).max(2).describe("场景序号 0/1/2"),
    title: z.string().describe("一句话命名，具体到'某人在某瞬间'"),
    description: z.string().describe("场景描述，一段话还原真实瞬间"),
    visual_anchors: z.string().describe("视觉锚点：环境/光线/时间/关键道具/着装"),
    emotional_hook: z.string().describe("情感诉求：用户看到画面心里会冒出的那句话"),
    audience_idx: z.number().int().min(0).describe("对应人群下标"),
});

const AudienceReportSchema = z.object({
    audiences: z.array(AudienceProfileSchema).min(2).max(4).describe("人群画像数组"),
    scenarios: z.array(TriggerScenarioSchema).length(3).describe("触发场景数组，恰好 3 个"),
});

type Report = z.infer<typeof AudienceReportSchema>;

interface Attempt {
    text: string;
    report: Report | null;
    issues: string[];
}

export async function identifyAudienceAndScenarios(ctx: IRunnerContext): Promise<void> {
    const store = new Storage(ctx);

    if (!checkExpiry(ctx, {
        inputKeys: store.productProfileKey(),
        outputKeys: [store.audienceScenariosKey(), store.audienceReportKey()],
    })) {
        ctx.info("[identifyAudienceAndScenarios] 人群场景仍新鲜，跳过");
        return;
    }

    const profile = store.getProductProfile();
    if (!profile) throwPrecondition("[identifyAudienceAndScenarios] 缺少产品事实");

    const messages: Array<{ role: "user" | "assistant"; content: string }> = [
        { role: "user", content: AUDIENCE_GENERATOR_PROMPT.user(profile) },
    ];

    const attempts: Attempt[] = [];
    let finalText = "";
    let finalReport: Report | null = null;

    for (let round = 1; round <= MAX_ROUNDS; round++) {
        // 1) 生成（或重生成）
        const { text } = await generateText({
            model: getSmartModel(undefined, ctx),
            instructions: AUDIENCE_GENERATOR_PROMPT.system,
            messages,
        });
        messages.push({ role: "assistant", content: text });

        // 2) 并行：LLM 评审 + 结构化抽取（零依赖）
        const [critiqueResult, fmtResult] = await Promise.all([
            generateText({
                model: getSmartModel(undefined, ctx),
                instructions: AUDIENCE_CRITIQUE_PROMPT.system,
                prompt: AUDIENCE_CRITIQUE_PROMPT.user(text, profile),
            }),
            safefmt(text, Output.object({ schema: AudienceReportSchema }), ctx),
        ]);

        // 仅 ISSUE: 视为硬伤（阻断）；SUGGEST: 是优化建议，不阻断
        const issues = critiqueResult.text.split("\n")
            .map(l => l.trim())
            .filter(l => /^ISSUE:/i.test(l));

        const structuralIssues: string[] = [];
        let report: Report | null = null;
        if (fmtResult.success && fmtResult.value) {
            const r = fmtResult.value.output;          // 局部收窄为非空
            report = r;
            structuralIssues.push(...programmaticChecks(r));
        } else {
            structuralIssues.push(`结构化抽取失败：${getErrorMessage(fmtResult.err) ?? "未知"}`);
        }

        const allIssues = [...issues, ...structuralIssues];
        attempts.push({ text, report, issues: allIssues });

        if (allIssues.length === 0 && report) {
            finalText = text;
            finalReport = report;
            break;
        }

        ctx.warn(`[identifyAudienceAndScenarios] 第 ${round} 轮存在 ${allIssues.length} 条问题：\n${allIssues.join("\n")}`);
        if (round < MAX_ROUNDS) {
            messages.push({
                role: "user",
                content:
                    `你的方案存在以下问题（每条已附可行条件与建议替代）：\n${allIssues.join("\n")}\n\n`
                    + `修正原则：\n`
                    + `1. 若某场景的产品使用动作/装备被判不可行，且无法满足其"可行条件"，则**整体替换**为该产品最主流、最无争议的使用场景，不要给不成立的场景打补丁。\n`
                    + `2. 宁可三场都平实正确，也不要为了差异化而虚构产品不具备的功能或违背材料物理常识。\n`
                    + `3. 保持已判定正确的部分不变。\n\n请重新输出完整方案。`,
            });
        }
    }

    // ==========================================================
    // 兜底：3 轮未完全通过时，保证仍产出一份结构化报告（绝不卡死下游）
    // ==========================================================
    if (!finalReport) {
        const candidates = attempts.filter(a => a.report);

        // 三选一 + 融合：交给融合器把候选合成一版最优
        if (candidates.length > 0) {
            const fused = await fuseCandidates(ctx, profile, candidates);
            if (fused) {
                finalText = fused.text;
                finalReport = fused.report;
                ctx.warn("[identifyAudienceAndScenarios] 3 轮未完全通过，已融合候选产出最终版本（残留建议不阻断，仅告警）");
            }
        }

        // 融合失败：退化为"问题最少"的那一版
        if (!finalReport && candidates.length > 0) {
            const best = [...candidates].sort((a, b) => a.issues.length - b.issues.length)[0];
            finalText = best.text;
            finalReport = best.report;
            ctx.warn(`[identifyAudienceAndScenarios] 融合失败，采用问题最少的一版（残留 ${best.issues.length} 条）：\n${best.issues.join("\n")}`);
        }
    }

    // 极端兜底：全程未能抽出任何结构化报告（safefmt 全挂）——才真正需要人工介入
    if (!finalReport) {
        finalText = attempts[attempts.length - 1]?.text ?? "";
        if (finalText) store.saveAudienceScenarios(finalText);
        throwUnprcessable("[identifyAudienceAndScenarios] 3 轮均无法抽出结构化人群报告，需人工检查产品输入");
    }

    store.saveAudienceScenarios(finalText);
    store.saveAudienceReport(finalReport);
    ctx.info(`[identifyAudienceAndScenarios] 完成，人群场景 ${finalText.length} 字，结构化报告已落盘`);
}

/**
 * 融合器：把多个候选方案合成一版最优（保留正确部分，替换不可行场景）。
 * 抽取失败返回 null，由上层退化到 best-pick。
 */
async function fuseCandidates(
    ctx: IRunnerContext,
    profile: string,
    candidates: Attempt[],
): Promise<{ text: string; report: Report } | null> {
    const block = candidates
        .map((a, i) =>
            `### 候选方案 ${i + 1}（残留问题 ${a.issues.length} 条）\n${a.text}\n\n残留问题：\n${a.issues.join("\n") || "无"}`,
        )
        .join("\n\n---\n\n");

    const { text } = await generateText({
        model: getSmartModel(undefined, ctx),
        instructions: AUDIENCE_FUSION_PROMPT.system,
        prompt: AUDIENCE_FUSION_PROMPT.user(profile, block),
    });

    const fmt = await safefmt(text, Output.object({ schema: AudienceReportSchema }), ctx);
    if (fmt.success && fmt.value) return { text, report: fmt.value.output };
    return null;
}

function programmaticChecks(report: Report): string[] {
    const issues: string[] = [];

    const tokens = report.scenarios.map(s => new Set(gramSplit(`${s.title} ${s.description} ${s.visual_anchors}`)));
    for (let i = 0; i < tokens.length; i++) {
        for (let j = i + 1; j < tokens.length; j++) {
            const overlap = jaccard(tokens[i], tokens[j]);
            if (overlap > 0.7) {
                issues.push(`ISSUE:C4 场景 ${i + 1} 与场景 ${j + 1} 高度重叠（jaccard=${overlap.toFixed(2)}），未满足正交要求`);
            }
        }
    }

    for (const sc of report.scenarios) {
        if (sc.audience_idx < 0 || sc.audience_idx >= report.audiences.length) {
            issues.push(`ISSUE:C2 场景 ${sc.idx + 1} 的 audience_idx=${sc.audience_idx} 越界（人群总数 ${report.audiences.length}）`);
        }
    }

    for (let i = 0; i < report.audiences.length; i++) {
        const a = report.audiences[i];
        const blanks = [
            !a.age_range && "年龄段",
            !a.region && "聚集地",
            !a.pain_point && "痛点",
            !a.derivation && "推导溯源",
        ].filter(Boolean);
        if (blanks.length > 0) {
            issues.push(`ISSUE:C2 人群 ${i + 1} 缺失要素：${blanks.join("、")}`);
        }
    }

    return issues;
}

function gramSplit(s: string): string[] {
    const cleaned = s.toLowerCase().replace(/[^\u4e00-\u9fa5a-z0-9]+/g, " ");
    const out: string[] = [];
    for (const word of cleaned.split(/\s+/).filter(Boolean)) {
        if (/^[\u4e00-\u9fa5]+$/.test(word)) {
            for (let i = 0; i < word.length - 1; i++) out.push(word.slice(i, i + 2));
        } else {
            out.push(word);
        }
    }
    return out;
}

function jaccard(a: Set<string>, b: Set<string>): number {
    if (a.size === 0 || b.size === 0) return 0;
    let inter = 0;
    for (const x of a) if (b.has(x)) inter++;
    return inter / (a.size + b.size - inter);
}