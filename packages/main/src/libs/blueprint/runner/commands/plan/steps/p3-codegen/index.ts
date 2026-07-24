/**
 * P-Pass3 · codeGen：节点代码生成
 *   - 并行处理所有 awaiting_code 节点（Promise.allSettled）
 *   - 每节点：planNode(规则+轻量LLM) + promptGen + codeGen + compile(reAct)
 *   - 编译通过即合格（沙箱执行留作未来拓展）
 *   - 单节点失败标记 conflict，不阻塞其他节点状态写入；整体任一失败最终抛出
 *   - 落盘：代码 + 提示词写入 kv（提示词供运行时动态加载）
 */

import type { PNode } from "$types/index.js";
import Logger from "electron-log/main.js";
import type { PlanContext } from "../../context.js";
import { NodeStatusValue } from "../../graph/gdag.js";
import { persistArtifact, persistDag } from "./persist.js";
import { generateForNode } from "./pipeline.js";

export class CodeGenFailure extends Error {
    constructor(
        readonly nodeId: string,
        readonly reason: string,
        readonly suggestion: string,
    ) {
        super(`[codegen]「${nodeId}」失败：${reason}`);
        this.name = 'CodeGenFailure';
    }
}

export async function codeGenForNode(node: PNode, pctx: PlanContext): Promise<void> {
    const artifact = await generateForNode(node, pctx);
    persistArtifact(artifact, pctx);
}

const DEBUG = false;

export async function codeGen(pctx: PlanContext): Promise<void> {
    const gdag = pctx.gdag;
    const targets = gdag.scan(NodeStatusValue.awaiting_code);
    if (targets.length === 0) {
        Logger.debug("[codegen] 无待生成节点，跳过");
        return;
    }

    Logger.debug(`[codegen] 开始生成，共 ${targets.length} 个节点`);

    const realTargets = DEBUG && targets.length > 0 ? [targets[0]] : targets;

    // Promise.allSettled：单节点失败不阻塞其他节点状态写入
    const settled = await Promise.allSettled(
        realTargets.map(async ({ node }) => {
            try {
                Logger.debug("generate for node")
                Logger.debug(JSON.stringify(node, null, 2))
                await codeGenForNode(node, pctx);
                if (!DEBUG) {
                    gdag.updateNode(node.id, { status: 'done' });
                }
                return node.id;
            } catch (err) {
                if (err instanceof CodeGenFailure) {
                    if (!DEBUG) {
                        gdag.updateNode(node.id, { status: 'conflict', error: err.reason });
                    }
                    Logger.error(`[codegen]「${node.name}」失败：${err.reason}`);
                }
                throw err;
            }
        }),
    );

    const failures = settled.filter(
        (r): r is PromiseRejectedResult => r.status === 'rejected',
    );

    if (failures.length > 0) {
        const first = failures[0].reason;
        pctx.persist();
        if (first instanceof CodeGenFailure) throw first;
        throw new AggregateError(
            failures.map(f => f.reason),
            `[codegen] ${failures.length}/${realTargets.length} 节点失败`,
        );
    }

    persistDag(pctx);

    pctx.persist();
    Logger.debug(`[codegen] 完成：${realTargets.length} 个节点`);
}