/**
 * weaver · 工作流主入口
 *
 * v4：新增 generate-instructions 阶段
 */

import { PrjDB } from "$libs/project/controllers/drizzle/index.js";
import type { IRunnerContext } from "$types/blueprint/context.js";
import { getErrorMessage } from "radashi";
import { createWeaveContext } from "./context.js";
import { compileWorkflow } from "./nodes/compile/index.js";
import { generateInstructions } from "./nodes/generate-instructions/index.js";
import { parseWorkflow } from "./nodes/parse/index.js";
import { preprocessArtifacts } from "./nodes/preprocess-artifacts/index.js";

const STEP = {
    Parse: 1,
    Preprocess: 2,
    Compile: 3,
    GenerateInstructions: 4,
    Dump: 5,
} as const;

function parseTargetStep(raw: string | null | undefined): number {
    if (!raw) return Infinity;
    const m = raw.trim().match(/^(\d+)\/(\d+)$/);
    if (!m) return Infinity;
    const x = parseInt(m[1], 10);
    const y = parseInt(m[2], 10);
    if (x < 1 || x > y) return Infinity;
    return x;
}

export async function run(ctx: IRunnerContext): Promise<void> {
    const weaveCtx = createWeaveContext(ctx);
    weaveCtx.ctx.notify("weaver", "开始编译");

    const prjdb = PrjDB.ensure(ctx.prj);
    const targetStep = parseTargetStep(prjdb.get<string>("target"));

    try {
        // ══════════════════════════════════════════════════════════════
        // 根层 reAct：parse ↔ preprocess 双向反馈循环
        // ══════════════════════════════════════════════════════════════

        const ROOT_MAX_ROUNDS = weaveCtx.storage.config.getMaxReactRounds();
        let preprocessResult: Awaited<ReturnType<typeof preprocessArtifacts>> | null = null;

        for (let rootRound = 0; rootRound < ROOT_MAX_ROUNDS; rootRound++) {
            ctx.notify("weaver", `根层第 ${rootRound + 1}/${ROOT_MAX_ROUNDS} 轮`);

            // ── ① parse ──
            const frozenNames = preprocessResult?.requiresParseRerun?.frozenNames ?? null;
            const forceRerun = rootRound > 0;

            ctx.notify(
                "parse",
                rootRound === 0
                    ? "开始解析"
                    : `重跑解析（冻结 ${frozenNames?.names.length ?? 0} 个 artifact 名）`,
            );

            weaveCtx.conceptManager.clear();
            await parseWorkflow(weaveCtx, { frozenNames, forceRerun });

            if (targetStep <= STEP.Parse) {
                const flows = weaveCtx.conceptManager.listHumanFlows();
                ctx.notify("weaver 完成（target=parse）", `共 ${flows.length} 个工作流`);
                return;
            }

            // ── ② preprocess ──
            preprocessResult = await preprocessArtifacts(weaveCtx);

            if (preprocessResult.success) {
                ctx.notify("weaver", "parse + preprocess 通过，进入下一阶段");
                break;
            }

            if (preprocessResult.requiresParseRerun) {
                ctx.notify(
                    "weaver",
                    `preprocess 要求 parse 重跑（${preprocessResult.requiresParseRerun.feedback.length} 条反馈）`,
                );
                continue;
            }

            break;
        }

        if (targetStep <= STEP.Preprocess) {
            ctx.notify("weaver 完成（target=preprocess）", "artifact 关系已整理");
            return;
        }

        // ── ③ compile ──
        await compileWorkflow(weaveCtx);
        if (targetStep <= STEP.Compile) {
            const flows = weaveCtx.conceptManager.listHumanFlows();
            ctx.notify("weaver 完成（target=compile）", `共 ${flows.length} 个工作流`);
            return;
        }

        // ── ④ generate-instructions ──
        await generateInstructions(weaveCtx);
        if (targetStep <= STEP.GenerateInstructions) {
            ctx.notify("weaver 完成（target=generate-instructions）", "所有提示词已生成");
            return;
        }

        ctx.notify(
            "weaver 完成",
            `共 ${weaveCtx.conceptManager.count()} 个概念`,
        );
    } catch (err) {
        weaveCtx.ctx.notify("weaver 失败", getErrorMessage(err));
        throw err;
    }
}

export async function compile(ctx: IRunnerContext): Promise<void> {
    return run(ctx);
}