
import { userClarifyTool } from '$libs/innerflow/common/clarify/index.js';
import { PrjRunner } from '$libs/project/controllers/runner.js';
import { os } from "@orpc/server";
import Logger from 'electron-log/main.js';
import { z } from 'zod';
import { RpcContext } from '../type.js';


const start = os
    .input(z.number().optional())
    .output(z.void())
    .handler(async ({ input, context }) => {
        const ctx = context as RpcContext;
        const runner = PrjRunner.ensure(ctx.project);
        runner.start(undefined, input);
    });


const stop = os
    .input(z.boolean().optional().default(false))
    .output(z.void())
    .handler(async ({ input, context }) => {
        const ctx = context as RpcContext;
        const runner = PrjRunner.ensure(ctx.project);
        runner.stop(input);
    });


const waitFinish = os
    .input(z.void())
    .output(z.void())
    .handler(async ({ context }) => {
        const ctx = context as RpcContext;
        const runner = PrjRunner.ensure(ctx.project);
        await runner.waitFinish();
    });

const runState = os
    .input(z.void())
    .output(z.enum(['idle', 'running', 'terminating']))
    .handler(async ({ context }) => {
        const ctx = context as RpcContext;
        const runner = PrjRunner.ensure(ctx.project);
        return runner.runState;
    });

const startTime = os
    .input(z.void())
    .output(z.number())
    .handler(async ({ context }) => {
        const ctx = context as RpcContext;
        const runner = PrjRunner.ensure(ctx.project);
        return runner.startTime;
    });

const clarify = os
    .input(z.object({
        uuid: z.string(),
        answer: z.string()
    }))
    .output(z.boolean())
    .handler(({ input }) => {
        if (input.answer) {
            return userClarifyTool.resolveClarification(input.uuid, input.answer);
        }
        return userClarifyTool.rejectClarification(input.uuid, input.answer);
    });

type ReflectPhase = {
    title: string;
    detail: string;
} | null;
// 流式事件：阶段更新 or 最终文本（真实场景可再加 token 增量等）
type StreamEvent =
    | { type: "phase"; phase: NonNullable<ReflectPhase> }
    | { type: "text"; text: string };

const runCommand = os
    .input(z.object({
        msg: z.string(),
        seq: z.number()
    }))
    .handler(async function* ({ input, context, signal }) {
        // @ts-expect-error 不写类型定义了。
        const externalSignal: AbortSignal | undefined = signal ?? context?.signal;
        const ctx = context as RpcContext;

        // Logger.debug('signal on runCommand:', externalSignal);

        // 无论外部有没有 signal，都用一个内部 controller 兜底：
        // 1) 内层总能拿到可用 signal；2) client 断开时我们能主动触发它。
        const controller = new AbortController();
        const innerSignal = controller.signal;

        // 把外部 signal 的 abort 转发到内部 controller，保持两者一致。
        const forwardAbort = () => {
            if (!controller.signal.aborted) controller.abort();
        };
        if (externalSignal) {
            if (externalSignal.aborted) forwardAbort();
            else externalSignal.addEventListener('abort', forwardAbort);
        }

        // 外部监听清理（幂等）
        let externalListenerRemoved = false;
        const removeExternalListener = () => {
            if (externalListenerRemoved) return;
            externalListenerRemoved = true;
            externalSignal?.removeEventListener('abort', forwardAbort);
        };

        const runner = PrjRunner.ensure(ctx.project);

        // 待消费的事件队列
        const queue: StreamEvent[] = [];
        let resolveNext: (() => void) | null = null;

        // 唤醒正在等待的消费者（幂等：取出后置空）
        const wakeup = () => {
            if (resolveNext) {
                const r = resolveNext;
                resolveNext = null;
                r();
            }
        };

        // 回调（生产者）：title 为空 -> text 事件；否则 -> phase 事件。
        const onPhase = (title: string, detail: string) => {
            if (!title) {
                queue.push({ type: 'text', text: detail });
            } else {
                queue.push({ type: 'phase', phase: { title, detail } });
            }
            wakeup();
        };

        // 结束通知（幂等）
        let endNotified = false;
        const notifyEnd = (suc: boolean) => {
            if (endNotified) return;
            endNotified = true;
            try {
                ctx.project.notify('runcommand-end', { suc, seq: input.seq });
            } catch (e) {
                Logger.debug('notify runcommand-end failed:', e);
            }
        };

        // 提前取消：内层还没启动，视为未成功
        if (innerSignal.aborted) {
            removeExternalListener();
            notifyEnd(false);
            return;
        }

        // 用对象包状态，规避 TS 对 let 字面量的控制流收窄；
        // 成功/失败只看 runPromise 的真实落定结果，与 signal 无关。
        const state = {
            done: false,
            settled: 'pending' as 'pending' | 'fulfilled' | 'rejected',
            error: undefined as unknown,
        };

        const runPromise = Promise.resolve(runner.runCommand(input.msg, onPhase, innerSignal))
            .then(() => {
                state.settled = 'fulfilled';
            })
            .catch((err) => {
                state.settled = 'rejected';
                state.error = err;
            })
            .finally(() => {
                state.done = true;
                wakeup(); // 完成时也唤醒，避免消费者永久阻塞
            });

        // abort 时唤醒消费者，让循环尽快退出
        const onAbort = () => wakeup();
        innerSignal.addEventListener('abort', onAbort);

        try {
            while (true) {
                // 优先把已入队的事件全部消费完（保证已产生的数据不丢）
                if (queue.length > 0) {
                    yield queue.shift()!;
                    continue;
                }

                // 退出条件：被取消，或 runCommand 已结束且队列已清空
                if (innerSignal.aborted) break;
                if (state.done) break;

                // 等待新的事件 / 完成 / 取消
                await new Promise<void>((resolve) => {
                    resolveNext = resolve;
                });
            }

            // 内层真的报错、且不是取消导致的，才向上抛
            if (state.settled === 'rejected' && !innerSignal.aborted) {
                throw state.error;
            }
        } finally {

            // 成功判定：未aborted并且 runPromise 是否成功落定
            const suc = !innerSignal.aborted && state.settled === 'fulfilled';
            // 若退出并非 abort 触发（例如 orpc client 断开导致 return），
            // 主动触发 innerSignal，给内层一个退出机会。
            if (state.settled === "pending" && !innerSignal.aborted) {
                controller.abort();
            }

            // 移除所有监听，避免泄漏
            innerSignal.removeEventListener('abort', onAbort);
            removeExternalListener();

            // 断开 resolveNext 引用，防止悬空回调
            resolveNext = null;

            // 等内层真正结束——await 之后 state.settled 一定是终态
            await runPromise.catch(() => { });

            notifyEnd(suc);

            Logger.debug('quit runCommand successfully.', suc);
        }
    });

export default {
    start,
    stop,
    waitFinish,
    runState,
    startTime,
    runCommand,
    clarify
}