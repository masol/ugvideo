// src/lib/stores/msg.svelte.ts
import type { Message } from "$lib/components/markdown/type";
import { safeApi } from "$lib/utils/api";
import evtbus from "$lib/utils/evtbus";
import Logger from "electron-log/renderer.js";
import pTimeout, { TimeoutError } from "p-timeout";
import { toast } from "svelte-sonner"; // 按你的项目实际 toast 库调整

export type ReflectPhase = {
    title: string;
    detail: string;
} | null;

// 流式事件：阶段更新 or 最终文本（真实场景可再加 token 增量等）
type StreamEvent =
    | { type: "phase"; phase: NonNullable<ReflectPhase> }
    | { type: "text"; text: string };

/** 等待主进程侧确认 seq 对应任务彻底结束的超时时长 */
const RUNCOMMAND_END_TIMEOUT_MS = 15 * 60 * 1000;

/** 单个 seq 调用的完成态，由 runcommand-end 事件 resolve */
type SeqDeferred = {
    promise: Promise<boolean>;
    resolve: (suc: boolean) => void;
};

function createDeferred(): SeqDeferred {
    let resolve!: (suc: boolean) => void;
    const promise = new Promise<boolean>((res) => {
        resolve = res;
    });
    return { promise, resolve };
}

class MessageStore {
    constructor() {
        evtbus.on("runcommand-end", ({ suc, seq }) => {
            const pending = this.#pendingSeqs.get(seq);
            if (pending) {
                this.#pendingSeqs.delete(seq);
                pending.resolve(suc);
            } else {
                // 没有等待者：可能是超时清理后迟到的事件，或异常来源，忽略即可
                Logger.debug("runcommand-end received with no pending waiter", { suc, seq });
            }
        });
    }

    messages = $state<Message[]>([]);
    isLoading = $state(false);

    /** 当前 AI 工作阶段（反思中/生成中），null 表示无 */
    phase = $state<ReflectPhase>(null);

    /** 是否处于「终止中」——已发出 abort 信号但流尚未结束 */
    isAborting = $state(false);

    hasMessages = $derived(this.messages.length > 0);
    lastMessage = $derived(
        this.messages.length > 0 ? this.messages[this.messages.length - 1] : null,
    );

    #controller: AbortController | null = null;
    /** 当前运行中的流消费 promise；null 表示空闲 */
    #runPromise: Promise<void> | null = null;

    /** 下一个可用调用序号，单调递增，用于与主进程 runcommand-end 对齐 */
    #nextSeq = 1;
    /** 等待主进程确认结束的 seq -> deferred 映射 */
    #pendingSeqs = new Map<number, SeqDeferred>();

    addMessage(message: Omit<Message, "id" | "timestamp">) {
        const newMessage: Message = {
            ...message,
            id: crypto?.randomUUID?.() ?? Date.now().toString(),
            timestamp: new Date(),
        };
        this.messages = [...this.messages, newMessage];
        return newMessage;
    }

    clear() {
        this.messages = [];
    }

    deleteMessage(id: string) {
        this.messages = this.messages.filter((msg) => msg.id !== id);
    }

    setLoading(loading: boolean) {
        this.isLoading = loading;
    }

    /**
     * 流式消费入口：若已有任务在运行则报错退出；否则启动一轮消费。
     * 期间可调用 abort() 提前终止。
     */
    AIResponse(userMessage: string): Promise<void> {
        // 已有任务在跑 — 直接报错退出，不打断当前任务
        if (this.#runPromise) {
            toast.error("已有任务正在进行，请等待完成或先终止当前任务");
            return Promise.resolve();
        }

        this.#controller = new AbortController();
        const { signal } = this.#controller;

        this.isAborting = false;
        this.setLoading(true);

        const run = this.#run(userMessage, signal);
        this.#runPromise = run;
        return run;
    }

    /** 内部：真正的流消费主循环 */
    async #run(userMessage: string, signal: AbortSignal): Promise<void> {
        // 将 stream 提至上层作用域，确保 finally 块可以访问
        let stream: AsyncGenerator<StreamEvent> | null = null;

        // 分配本次调用的 seq，并在发起请求前注册等待者，避免和 runcommand-end 竞态
        const seq = this.#nextSeq++;
        const deferred = createDeferred();
        this.#pendingSeqs.set(seq, deferred);
        let finalText = "";
        let responsed = false;

        try {

            stream = await safeApi().project.runCommand({
                msg: userMessage,
                seq,
            }, { signal });

            for await (const evt of stream) {
                if (signal.aborted) break;
                if (evt.type === "phase") {
                    if (evt.phase.title === 'error') {
                        this.addMessage({
                            role: "assistant",
                            isError: true,
                            content: evt.phase.detail,
                        });
                        responsed = true;
                    } else {
                        this.phase = evt.phase;
                    }
                }
                else finalText = evt.text;
            }

            // // 只有未被中断且拿到文本才落地
            // if (!signal.aborted && finalText) {
            //     this.addMessage({ role: "assistant", content: finalText });
            // }
        } catch (err) {
            // abort 引发的异常静默吞掉，其余才提示
            if (signal.aborted) {
                this.phase = {
                    title: "终止命令",
                    detail: "向命令中心请求终止，等待其终止确认中...",
                }
            } else {
                this.addMessage({
                    role: "assistant",
                    isError: true,
                    content: `处理失败：${err instanceof Error ? err.message : String(err)}`,
                });
                responsed = true;
            }
        } finally {
            if (stream && typeof stream.return === "function") {
                try {
                    Logger.debug("waiting for stream.return()...", { seq });
                    await stream.return(undefined);
                } catch (returnErr) {
                    // 静默吞掉生成器关闭时的异常
                    Logger.error("Failed to close run command stream safely:", returnErr);
                }
            }

            // 客户端迭代器已关闭，但主进程侧任务是否真正收尾，
            // 必须等 runcommand-end(seq) 确认，否则可能是「假终止」
            await this.#waitForRunEnd(seq, deferred);
            if (finalText) {
                this.addMessage({ role: "assistant", content: finalText });
            } else if (signal.aborted) {
                this.addMessage({
                    role: "assistant",
                    content: `您终止了当前任务，查看日志了解执行细节。`,
                });
            } else if (!responsed) {
                this.addMessage({ role: "assistant", isError: true, content: "任务正常结束，但是AI没有返回任意最终文本，请查阅日志了解细节。" });
            }
            this.phase = null;
            this.isAborting = false;
            this.setLoading(false);
            this.#controller = null;
            this.#runPromise = null;
        }
    }

    /**
     * 等待主进程通过 runcommand-end 确认 seq 对应任务已彻底结束。
     * 5 分钟内未收到确认视为「悬置」：清理本地等待者并强提示用户重启，
     * 因为此时无法确认主进程侧能力组件/术语库是否仍在运行或已产生副作用。
     */
    async #waitForRunEnd(seq: number, deferred: SeqDeferred): Promise<void> {
        try {
            const suc = await pTimeout(deferred.promise, {
                milliseconds: RUNCOMMAND_END_TIMEOUT_MS,
            });
            Logger.debug("runcommand-end confirmed", { seq, suc });
        } catch (err) {
            if (err instanceof TimeoutError) {
                this.#pendingSeqs.delete(seq);
                Logger.error("Timed out waiting for runcommand-end confirmation", { seq });
                const msg = "终止任务超时：未能确认主进程的任务已完全结束。为安全起见，请关闭全部窗口并重启应用，避免悬置的能力组件意外更新术语库。"
                this.addMessage({
                    role: "assistant",
                    isError: true,
                    content: msg,
                });
                toast.error(msg);
            } else {
                Logger.error("Unexpected error while waiting for runcommand-end", err);
            }
        }
    }

    /**
     * 请求终止：发信号 + 切「终止中」状态，
     * 然后等待 #run 真正收尾结束后才 resolve（包括等到 runcommand-end 确认）。
     */
    async abort(): Promise<void> {
        if (!this.#controller || !this.#runPromise) return;
        this.isAborting = true;
        this.#controller.abort();
        // 等待流（含 generator 的 finally 收尾，以及主进程结束确认）彻底结束
        await this.#runPromise;
    }
}

const KEY = Symbol.for('unigen.renderer.messageStore');
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const messageStore: MessageStore = ((globalThis as any)[KEY] ??= new MessageStore());