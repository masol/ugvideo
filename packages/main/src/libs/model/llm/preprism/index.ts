import { getSmartModel } from "$libs/model/balancer/get-smart-model.js";
import { configService } from "$libs/store/index.js";
import { IRunnerContext } from "$types/blueprint/context.js";
import { generateText, Output } from "ai";
import Logger from "electron-log/main.js";
import pMap from "p-map";
import { NL2Format } from "../outline.js";
import {
    ANALYZE_SYSTEM,
    analyzeUser,
    critiqueSystem,
    critiqueUser,
    REFINE_SYSTEM,
    refineUser,
} from "./prompts.js";
import {
    AnalysisSchema,
    CritiqueSchema,
    RefineSchema,
    type Critique,
    type Dimension,
} from "./schemas.js";
import { buildAnswerSystem } from "./system-template.js";

export interface PreprismOpts {
    maxDimensions?: number; // 硬上限 5
    kind?: string;
}

export interface PreprismTextResult {
    text: string;
}

const HARD_MAX_DIMENSIONS = 5;

function normalizeName(name: string): string {
    return name
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "_")
        .replace(/^_+|_+$/g, "")
        .replace(/_+/g, "_");
}

/**
 * preprism:先侦察、再作答、评一轮。
 */
export async function preprism(
    query: string,
    opts?: PreprismOpts,
    ctx?: IRunnerContext
): Promise<PreprismTextResult> {
    const log = Logger.debug;
    const tag = opts?.kind ? `[preprism:${opts.kind}]` : "[preprism]";
    const maxDims = Math.min(
        opts?.maxDimensions ?? HARD_MAX_DIMENSIONS,
        HARD_MAX_DIMENSIONS
    );

    // 1) 问题侦察
    const analyzed = await NL2Format({
        model: getSmartModel(undefined, ctx),
        instructions: ANALYZE_SYSTEM,
        prompt: analyzeUser(query),
        output: Output.object({ schema: AnalysisSchema }),
    });
    log(`${tag} analysis:\n${JSON.stringify(analyzed.output)}`);

    // 维度归一化去重 + 截断
    const seen = new Set<string>();
    const dimensions: Dimension[] = [];
    for (const d of analyzed.output.dimensions) {
        const name = normalizeName(d.name);
        if (!name || seen.has(name)) continue;
        seen.add(name);
        dimensions.push({ ...d, name });
        if (dimensions.length >= maxDims) break;
    }

    // 守卫:归一化去重后必须至少有一个有效维度,否则侦察失败,直接降级生成
    if (dimensions.length === 0) {
        log(`${tag} 侦察未产出有效维度,降级为单次生成`);
        const fallback = await generateText({
            model: getSmartModel(undefined, ctx),
            prompt: query,
        });
        return { text: fallback.text };
    }

    const analysis = { ...analyzed.output, dimensions };
    ctx?.notify(
        "问题侦察",
        JSON.stringify(analysis, null, 2) + "\n" + dimensions.map((d) => d.name).join(", ")
    );

    // 2) 组装动态系统提示词
    const answerSystem = buildAnswerSystem(analysis);
    log(`${tag} dynamic system:\n${answerSystem}`);
    ctx?.notify("动态系统提示词", answerSystem);

    // 3) 带专家人设生成草稿
    const draft = await generateText({
        model: getSmartModel(undefined, ctx),
        system: answerSystem,
        prompt: query,
    });
    log(`${tag} draft:\n${draft.text}`);
    ctx?.notify("专家草稿", draft.text);

    // 4) 分维批判
    const critiques = await critiqueAll(query, draft.text, dimensions, tag, ctx);

    // 5) 精炼
    let cur = draft.text;
    const r = await NL2Format({
        model: getSmartModel(undefined, ctx),
        instructions: REFINE_SYSTEM,
        prompt: refineUser(query, cur, critiques),
        output: Output.object({ schema: RefineSchema }),
    });
    log(`${tag} refine reasoning:\n${JSON.stringify(r.output)}`);
    ctx?.notify("精炼结果", JSON.stringify(r.output, null, 2));

    const next = r.output.refined_artifact?.trim();
    if (r.output.changed && next && next !== cur) {
        cur = next;
        log(`${tag} changelog: ${r.output.changelog.join(" | ")}`);
        ctx?.notify("改进日志", r.output.changelog.join(" | "));
    } else {
        log(`${tag} refine no-op → 保留草稿`);
    }

    log(`${tag} changed=${cur !== draft.text}`);
    return { text: cur };
}

async function critiqueAll(
    query: string,
    artifact: string,
    dimensions: Dimension[],
    tag: string,
    ctx?: IRunnerContext
): Promise<Critique[]> {
    const critiques = await pMap(
        dimensions,
        async (d) => {
            const c = await NL2Format({
                model: getSmartModel(undefined, ctx),
                instructions: critiqueSystem(d),
                prompt: critiqueUser(query, artifact, d),
                output: Output.object({ schema: CritiqueSchema }),
            });
            Logger.debug(
                `${tag} critique[${d.name}] reasoning:\n${JSON.stringify(c.output)}`
            );
            return { ...c.output, dimension: d.name };
        },
        {
            concurrency: configService().get("concurrency"),
        }
    );
    ctx?.notify(
        "分维批判",
        critiques
            .map(
                (c) =>
                    `【${c.dimension}｜${c.score}/10】问题：${c.issues.length ? c.issues.join("；") : "（无）"
                    }`
            )
            .join("\n")
    );
    return critiques;
}