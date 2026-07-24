/**
 * ============================================================================
 * 【P-00 · 入口调度:双层 reAct 规划器】
 * ============================================================================
 * Pipeline:
 *   P1: designTop（双层 reAct：外层粒度控制 + 内层 DAG 设计）
 *   P2: logicalExpand（批量判定 + 递归展开）
 *   P3: codeGen（占位）
 *   flatten: 展平为单层可执行 DAG
 */
import { throwUnprcessable } from '$libs/utils/err.js';
import type { IRunnerContext } from '$types/blueprint/context.js';
import { MAX_ITERATIONS } from './config.js';
import { ConflictSignal, createPlanContext } from './context.js';
import { designTop } from './steps/p1-design.js';
import { logicalExpand } from './steps/p2-expand.js';
import { codeGen } from './steps/p3-codegen/index.js';

export async function runCmd(ctx: IRunnerContext): Promise<void> {
    const pctx = createPlanContext(ctx);
    const args = ctx.cmd.args ?? {}

    const nocodegen = (args['no-codegen'] ?? "").toLocaleLowerCase();

    for (let iter = 1; iter <= MAX_ITERATIONS; iter++) {
        try {
            await designTop(pctx);        // P1: 双层 reAct 设计顶层 DAG
            await logicalExpand(pctx);    // P2: 递归展开
            // const flatId = await flatten(pctx); // 展平
            if (!(nocodegen === 'on' || nocodegen === 'true')) {
                await codeGen(pctx);          // P3: 代码生成
            }
            ctx.notify("", "```json\n" +
                JSON.stringify(pctx.gdag.getGraph(pctx.gdag.rootId!)?.export(), null, 2) + "\n```");
            return;
        } catch (e) {
            if (e instanceof ConflictSignal) continue;
            throw e;
        }
    }
    throwUnprcessable(`[plan] 规划未收敛:达到轮次上限 ${MAX_ITERATIONS}`, true);
}