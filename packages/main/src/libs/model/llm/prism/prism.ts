import { getSmartModel } from "$libs/model/balancer/get-smart-model.js";
import { configService } from "$libs/store/index.js";
import { IRunnerContext } from "$types/blueprint/context.js";
import { generateText, Output } from "ai";
import Logger from "electron-log/main.js";
import pMap from "p-map";
import { NL2Format } from "../outline.js";
import {
    critiqueSystem,
    critiqueUser,
    KEEP_TOKEN,
    PASS_TOKEN,
    REFINE_SYSTEM,
    refineUser,
    SPLIT_SYSTEM,
    splitUser,
} from "./prompts.js";
import { FacetsSchema, type Facet, type FacetCritique } from "./schemas.js";

export interface PrismOpts {
    maxFacets?: number; // 硬上限 5
    maxRefineRounds?: number; // 硬上限 2
    kind?: string; // 仅留痕,用于日志记录。
}

/** 返回值就是 generateText 的返回值：调用方拿 .text 即可，与 vercel ai sdk 天然对齐。 */
export type PrismResult = Awaited<ReturnType<typeof generateText>>;

const HARD_MAX_FACETS = 5;
const HARD_MAX_ROUNDS = 2;

function normalizeName(name: string): string {
    return name
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "_")
        .replace(/^_+|_+$/g, "")
        .replace(/_+/g, "_");
}

/**
 * prism：把任意"生成一次答案"升级为
 * 草稿 → 棱面拆分 → 分面批判 → 合并精炼 的多棱面自省。
 * 通用推理外壳，对"怎么生成初稿"保持中立。是反思回路，不是 ReAct（无外部动作）。
 *
 * 复杂度均衡：批判者以"原文片段 → 改写后片段"的修改示范形式输出（重活前移），
 * 精炼器只做套用与合并；无问题的视角输出 PASS_TOKEN，代码在精炼前滤掉，
 * 全部通过则直接跳过精炼调用。二值门用 KEEP_TOKEN 哨兵实现，停机即回退。
 * 全程只在"棱面拆分"做一次结构化提取，其余交互均为自然语言，
 * 最终直接返回 generateText 的结果对象。
 */
export async function prism(
    query: string,
    opts?: PrismOpts,
    ctx?: IRunnerContext
): Promise<PrismResult> {
    const log = Logger.debug;
    const tag = opts?.kind ? `[prism:${opts.kind}]` : "[prism]";
    const maxFacets = Math.min(opts?.maxFacets ?? HARD_MAX_FACETS, HARD_MAX_FACETS);
    const maxRounds = Math.min(opts?.maxRefineRounds ?? HARD_MAX_ROUNDS, HARD_MAX_ROUNDS);

    // 1) 草稿（自然语言，本身就是候选返回值）
    let result: PrismResult = await generateText({
        model: getSmartModel(undefined, ctx),
        prompt: query,
    });
    const draftText = result.text;
    log(`${tag} draft:\n${draftText}`);
    ctx?.notify("首轮草稿", draftText);

    // 2) 棱面拆分（≤maxFacets，代码层归一化去重）——全流程唯一一次结构化提取
    const split = await NL2Format({
        model: getSmartModel(),
        instructions: SPLIT_SYSTEM,
        prompt: splitUser(query, draftText),
        output: Output.object({ schema: FacetsSchema }),
    });
    log(`${tag} split reasoning:\n${JSON.stringify(split.output)}`);

    const seen = new Set<string>();
    const facets: Facet[] = [];
    for (const f of split.output.facets) {
        const name = normalizeName(f.name);
        if (!name || seen.has(name)) continue;
        seen.add(name);
        facets.push({ ...f, name });
        if (facets.length >= maxFacets) break;
    }
    log(`${tag} facets: ${facets.map((f) => f.name).join(", ")}`);
    ctx?.notify(
        "视角信息",
        JSON.stringify(split.output, null, 2) + "\n" + facets.map((f) => f.name).join(", ")
    );

    // 3) 分面批判（各棱面独立、并发；都看到原始 query；产物是评审意见（附修改示范）或 PASS）
    let critiques = await critiqueAll(query, draftText, facets, tag, ctx);

    // 4) 合并精炼（≤maxRounds，PASS 预门控 + KEEP 哨兵二值门 + 回退）
    let cur = draftText;
    for (let round = 1; round <= maxRounds; round++) {
        // PASS 预门控：滤掉无问题的视角，缩小精炼器输入；全通过则不调精炼
        const actionable = critiques.filter((c) => !c.text.includes(PASS_TOKEN));
        const passed = critiques.length - actionable.length;
        if (passed > 0) {
            log(`${tag} refine#${round} ${passed}/${critiques.length} facets pass`);
        }
        if (actionable.length === 0) {
            log(`${tag} refine#${round} 全部视角通过 → 跳过精炼`);
            ctx?.notify(`第${round}轮改进`, "所有视角均无问题，保留当前稿。");
            break;
        }

        const r = await generateText({
            model: getSmartModel(undefined, ctx),
            system: REFINE_SYSTEM,
            prompt: refineUser(query, cur, actionable),
        });

        const next = r.text.trim();
        // 二值门：没改好（输出哨兵 / 产物空 / 与当前稿相同）就停 + 回退保留上一版
        if (!next || next.includes(KEEP_TOKEN) || next === cur) {
            log(`${tag} refine#${round} no-op → 回退保留当前稿`);
            break;
        }
        cur = next;
        result = r; // 精炼稿的结果对象整体成为新的候选返回值
        log(`${tag} refine#${round}:\n${next}`);
        ctx?.notify(`第${round}轮改进`, next);

        if (round < maxRounds) {
            critiques = await critiqueAll(query, cur, facets, tag, ctx);
        }
    }

    log(`${tag} changed=${cur !== draftText}`);
    return result;
}

async function critiqueAll(
    query: string,
    artifact: string,
    facets: Facet[],
    tag: string,
    ctx?: IRunnerContext
): Promise<FacetCritique[]> {
    const critiques = await pMap(
        facets,
        async (f) => {
            const c = await generateText({
                model: getSmartModel(undefined, ctx),
                system: critiqueSystem(f),
                prompt: critiqueUser(query, artifact, f),
            });
            Logger.debug(`${tag} critique[${f.name}]:\n${c.text}`);
            return { facet: f.name, text: c.text };
        },
        {
            concurrency: configService().get("concurrency"),
        }
    );
    return critiques;
}