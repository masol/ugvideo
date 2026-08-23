// src/lib/stores/msg.svelte.ts
import type { Message } from "$lib/components/markdown/type";
import { dashboardStore } from "$lib/store/dashboard.svelte";
import { bottomPanelStore } from "$lib/store/local/bottombar.store.svelte";
import { projectStore } from "$lib/store/project.svelte";
import { layoutStore } from "$lib/store/ui/layout.svelte";
import { safeApi } from "$lib/utils/api";
import evtbus from "$lib/utils/evtbus";
import Logger from "electron-log/renderer.js";
import pTimeout, { TimeoutError } from "p-timeout";
import { toast } from "svelte-sonner";

export type ReflectPhase = {
    title: string;
    detail: string;
};

export type PhaseRecord = ReflectPhase & {
    id: string;
    timestamp: Date;
};

type StreamEvent =
    | { type: "phase"; phase: ReflectPhase }
    | { type: "text"; text: string };

const RUNCOMMAND_END_TIMEOUT_MS = 15 * 60 * 1000;

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
                Logger.debug("runcommand-end received with no pending waiter", { suc, seq });
            }
        });
    }

    messages = $state<Message[]>([]);
    isLoading = $state(false);
    phase = $state<ReflectPhase | null>(null);
    isAborting = $state(false);

    // ✅ 新增：phase 历史记录（归档到消息）
    phaseHistory = $state<PhaseRecord[]>([]);

    hasMessages = $derived(this.messages.length > 0);
    lastMessage = $derived(
        this.messages.length > 0 ? this.messages[this.messages.length - 1] : null,
    );

    #controller: AbortController | null = null;
    #runPromise: Promise<void> | null = null;
    #nextSeq = 1;
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
        this.phaseHistory = [];
    }

    deleteMessage(id: string) {
        this.messages = this.messages.filter((msg) => msg.id !== id);
    }

    setLoading(loading: boolean) {
        this.isLoading = loading;
    }

    // ✅ 新增：归档当前 phase 到历史记录
    #archivePhase() {
        if (!this.phase) return;
        const record: PhaseRecord = {
            ...this.phase,
            id: crypto?.randomUUID?.() ?? Date.now().toString(),
            timestamp: new Date(),
        };
        this.phaseHistory = [...this.phaseHistory, record];
    }

    /**
     * 流式消费入口：互斥守卫 — 阻止与主控运行并发
     */
    AIResponse(userMessage: string): Promise<void> {
        if (this.#runPromise) {
            toast.error("已有对话任务正在进行，请等待完成或先终止");
            return Promise.resolve();
        }

        if (dashboardStore.runState !== "idle") {
            toast.error("主控任务正在运行，请等待完成或先终止主控");
            return Promise.resolve();
        }

        if (!projectStore.opened) {
            toast.error("请先打开一个项目");
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

    async #run(userMessage: string, signal: AbortSignal): Promise<void> {
        let stream: AsyncGenerator<StreamEvent> | null = null;
        const seq = this.#nextSeq++;
        const deferred = createDeferred();
        this.#pendingSeqs.set(seq, deferred);
        let finalText = "";
        let responsed = false;

        // ✅ 本轮对话开始时，清空上一轮的 phase 历史（可选：根据产品需求决定是否保留）
        this.phaseHistory = [];

        try {
            stream = await safeApi().project.runCommand({
                msg: userMessage,
                seq,
            }, { signal });

            for await (const evt of stream) {
                if (signal.aborted) break;
                if (evt.type === "phase") {
                    // ✅ 修复：先归档旧 phase，再更新新 phase
                    this.#archivePhase();

                    if (evt.phase.title === 'error') {
                        this.addMessage({
                            role: "assistant",
                            isError: true,
                            content: evt.phase.detail,
                        });
                        responsed = true;
                        this.phase = null;
                    } else if (evt.phase.title === "show-asset") {
                        projectStore.mediaURL = evt.phase.detail;
                        layoutStore.openPanel("bottom");
                        bottomPanelStore.setActiveTab("media");
                        this.phase = null;
                    } else {
                        this.phase = evt.phase;
                    }
                } else {
                    finalText = evt.text;
                }
            }
        } catch (err) {
            if (signal.aborted) {
                this.phase = {
                    title: "终止命令",
                    detail: "向命令中心请求终止，等待其终止确认中...",
                };
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
                    Logger.error("Failed to close run command stream safely:", returnErr);
                }
            }

            await this.#waitForRunEnd(seq, deferred);

            // ✅ 修复：最终归档当前 phase
            this.#archivePhase();

            // ✅ 修复：将本轮的 phase 历史附加到即将创建的消息上
            const currentPhaseRecords = [...this.phaseHistory];

            if (finalText) {
                const msg = this.addMessage({ role: "assistant", content: finalText });
                msg.phaseRecords = currentPhaseRecords;
                responsed = true;
            } else if (signal.aborted) {
                const msg = this.addMessage({
                    role: "assistant",
                    content: `您终止了当前任务，查看日志了解执行细节。`,
                });
                msg.phaseRecords = currentPhaseRecords;
                responsed = true;
            }

            // ✅ 修复：只有真正没有任何响应时才添加兜底错误消息
            if (!responsed) {
                this.addMessage({
                    role: "assistant",
                    isError: true,
                    content: "任务正常结束，但 AI 没有返回任何最终文本，请查阅日志了解细节。",
                });
            }

            this.phase = null;
            this.isAborting = false;
            this.setLoading(false);
            this.#controller = null;
            this.#runPromise = null;
        }
    }

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
                const msg = "终止任务超时：未能确认主进程的任务已完全结束。为安全起见，请关闭全部窗口并重启应用，避免悬置的能力组件意外更新术语库。";
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

    async abort(): Promise<void> {
        if (!this.#controller || !this.#runPromise) return;
        this.isAborting = true;
        this.#controller.abort();
        await this.#runPromise;
    }
}

const KEY = Symbol.for('unigen.renderer.messageStore');
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const messageStore: MessageStore = ((globalThis as any)[KEY] ??= new MessageStore());