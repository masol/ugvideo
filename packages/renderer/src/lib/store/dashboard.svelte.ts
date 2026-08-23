// $lib/store/dashboard.svelte.ts
import { messageStore } from "$lib/store/local/msg.svelte";
import { projectStore } from "$lib/store/project.svelte";
import { confirmStore } from "$lib/store/ui/confirm.svelte";
import { api, safeApi } from "$lib/utils/api";
import evtbus from "$lib/utils/evtbus";
import { hooks } from "$lib/utils/hook";
import type { RunState } from "@app/main/types";
import log from "electron-log/renderer";
import { getErrorMessage } from "radashi";
import { toast } from "svelte-sonner";

interface LogEntry {
    id: string;
    time: number;
    message: string;
}

class DashboardStore {
    #elapsedSeconds = $state(0);
    #terminatingSeconds = $state(0);
    #logs = $state.raw<LogEntry[]>([]);
    #target = $state<string>("post");
    #preserveLogs = $state(false);
    forceShowLog = $state(false);
    viewMode = $state<"control" | "chat">("control");

    #seqCounter = 0;
    #activeSeq: number | null = null;
    #terminationRequested = false;

    #clockTimer: ReturnType<typeof setInterval> | null = null;
    #terminateTimer: ReturnType<typeof setInterval> | null = null;

    readonly showLog = $derived(this.runState !== 'idle' || this.forceShowLog)
    readonly #statusLabel = $derived(
        projectStore.runState === "idle"
            ? "空闲"
            : projectStore.runState === "running"
                ? "运行中"
                : "正在终止",
    );

    private getHintText(state: RunState): string {
        switch (state) {
            case 'idle':
                return projectStore.activity?.hints.idle ?? "点击下方按钮，让AI开始工作。";
            case 'running':
                return projectStore.activity?.hints.running ?? "每一步结果都会自动保存，再次运行不会重复计算。可随时点击「终止」，已完成的部分不会丢失。";
            default:
                return projectStore.activity?.hints.term ?? "正在等待当前这一步完成后安全停止。若此刻强制关机，当前正在进行的这一步将作废，需要重新计算。"
        }
    }

    readonly #hintText = $derived(
        this.getHintText(projectStore.runState)
    );

    readonly #buttonLabel = $derived(
        projectStore.runState === "idle"
            ? "开始运行"
            : projectStore.runState === "running"
                ? "终止任务"
                : "强制停止",
    );

    constructor() {
        log.info("[DashboardStore] initialized");

        evtbus.on("task_progess_report", (message: string) => {
            this.#pushLog(message);
        });

        evtbus.on("task_finished", (evt: { success: boolean; reason?: string; seq?: number }) => {
            if (!this.#isOwnedEvent(evt.seq)) {
                log.debug(
                    `[DashboardStore] ignore stale task_finished: evtSeq=${evt.seq ?? "undefined"}, activeSeq=${this.#activeSeq ?? "null"}`,
                );
                return;
            }

            log.info(
                `[DashboardStore] task_finished: seq=${evt.seq}, success=${evt.success}, reason=${evt.reason ?? ""}`,
            );

            this.#releaseRun();

            if (evt.success) {
                const msg = "✓ 任务已成功完成 · 所有步骤已保存";
                this.#pushLog(msg);
                confirmStore.request({
                    title: "任务成功",
                    message: msg,
                    hideCancel: true,
                    icon: "IconCheckFilled",
                    confirmLabel: "我知道了",
                    size: "xl"
                }).catch(e => toast.error(getErrorMessage(e)))
            } else {
                const reasonText = evt.reason ? ` · ${evt.reason}` : "";
                const msg = `✗ 任务已终止${reasonText}`;
                this.#pushLog(msg);
                confirmStore.request({
                    title: "任务失败",
                    message: msg,
                    hideCancel: true,
                    icon: "IconFaceIdError",
                    confirmLabel: "我知道了",
                    destructive: true,
                    size: "xl"
                }).catch(e => toast.error(getErrorMessage(e)))
            }
        });

        hooks.hook("project:loaded", async () => {
            this.#target = await safeApi().project.get("target");
            if (!this.#target && projectStore.activity) {
                const targetSize = projectStore.activity.targets.length;
                this.#target = `${targetSize}/${targetSize}`
            }
            this.#releaseRun();
        })
    }

    get target(): string {
        return this.#target;
    }
    get runState() {
        return projectStore.runState;
    }
    get elapsedSeconds() {
        return this.#elapsedSeconds;
    }
    get terminatingSeconds() {
        return this.#terminatingSeconds;
    }
    get logs() {
        return this.#logs;
    }
    get infoBlocks() {
        return projectStore.activity?.infocards ?? [];
    }
    get statusLabel() {
        return this.#statusLabel;
    }
    get hintText() {
        return this.#hintText;
    }
    get buttonLabel() {
        return this.#buttonLabel;
    }
    get preserveLogs() {
        return this.#preserveLogs;
    }

    async setTarget(newTarget: string): Promise<void> {
        await safeApi().project.set({
            key: "target",
            value: newTarget
        });
        this.#target = newTarget;
    }

    #isOwnedEvent(seq: number | undefined): boolean {
        return seq !== undefined && seq === this.#activeSeq;
    }

    #releaseRun() {
        this.#activeSeq = null;
        this.#terminationRequested = false;
        this.#clearTimers();
        this.#elapsedSeconds = 0;
        this.#terminatingSeconds = 0;
    }

    #pushLog(message: string) {
        this.#logs = [
            {
                id: crypto.randomUUID(),
                time: Date.now(),
                message,
            },
            ...this.#logs,
        ];
    }

    #clearTimers = () => {
        if (this.#clockTimer) {
            clearInterval(this.#clockTimer);
            this.#clockTimer = null;
        }
        if (this.#terminateTimer) {
            clearInterval(this.#terminateTimer);
            this.#terminateTimer = null;
        }
        log.debug("[DashboardStore] all timers cleared");
    };

    async #startRunning(): Promise<boolean> {
        // 🔒 守卫 1：主控已在运行
        if (projectStore.runState !== "idle" || this.#activeSeq !== null) {
            log.debug(
                `[DashboardStore] startRunning() rejected: runState=${projectStore.runState}, activeSeq=${this.#activeSeq ?? "null"}`,
            );
            return false;
        }

        // 🔒 守卫 2：对话任务正在运行
        if (messageStore.isLoading) {
            toast.error("对话任务正在运行，请等待完成或先终止对话");
            log.debug("[DashboardStore] startRunning() rejected: messageStore is loading");
            return false;
        }

        const seq = ++this.#seqCounter;
        this.#activeSeq = seq;
        this.#terminationRequested = false;
        log.debug(`[DashboardStore] startRunning() called, seq=${seq}`);

        if (!this.#preserveLogs) {
            this.#logs = [];
        }

        try {
            await projectStore.start(seq, true);
        } catch (err) {
            log.error("[DashboardStore] projectStore.start() failed", err);
            if (this.#activeSeq === seq) {
                this.#releaseRun();
            }
            return false;
        }

        if (this.#activeSeq !== seq) {
            log.debug(`[DashboardStore] startRunning() superseded, seq=${seq}`);
            return false;
        }

        if (projectStore.runState === "idle") {
            log.debug(`[DashboardStore] run already idle after start, seq=${seq}`);
            this.#releaseRun();
            return false;
        }

        const startime = await api().project.startTime();
        const nowTime = new Date().getTime();
        this.#elapsedSeconds = startime > 0 ? Math.floor((nowTime - startime) / 1000) : 0;

        log.info(`[DashboardStore] run started, seq=${seq}`);

        this.#clockTimer = setInterval(() => {
            this.#elapsedSeconds += 1;
        }, 1000);
        return true;
    }

    #enterTerminating(): boolean {
        if (this.#terminationRequested) {
            log.debug("[DashboardStore] enterTerminating() ignored: already requested");
            return false;
        }
        if (projectStore.runState !== "running" || this.#activeSeq === null) {
            log.debug(
                `[DashboardStore] enterTerminating() rejected: runState=${projectStore.runState}, activeSeq=${this.#activeSeq ?? "null"}`,
            );
            return false;
        }

        this.#terminationRequested = true;
        log.debug("[DashboardStore] enterTerminating() called");
        this.#terminatingSeconds = 0;
        this.#pushLog("收到终止信号 · 等待当前节点安全收尾 …");
        log.info("[DashboardStore] terminating requested");
        projectStore.stop(false);

        this.#terminateTimer = setInterval(() => {
            this.#terminatingSeconds += 1;
        }, 1000);
        return true;
    }

    #finalizeStop(message: string) {
        projectStore.stop(true);
        this.#releaseRun();
        this.#pushLog(message);
        log.info(`[DashboardStore] run stopped: ${message}`);
    }

    handleMainButton = async (): Promise<void> => {
        log.debug(
            `[DashboardStore] handleMainButton() called, runState=${projectStore.runState}`,
        );

        if (projectStore.runState === "idle") {
            await this.#startRunning();
            return;
        }

        if (projectStore.runState === "running") {
            this.#enterTerminating();
            return;
        }

        if (projectStore.runState === "terminating") {
            await this.forceStop();
        }
    };

    private async forceStop() {
        if (this.#activeSeq === null) {
            log.debug("[DashboardStore] forceStop() ignored: no active run");
            return;
        }
        const seq = this.#activeSeq;

        const ok = await confirmStore.request({
            title: "强制立即停止？",
            message:
                "当前正在进行的步骤将不会被保存，下次运行需要重新计算这一步。",
        });
        if (!ok) return;

        if (this.#activeSeq !== seq) {
            log.debug(`[DashboardStore] forceStop() superseded, seq=${seq}`);
            return;
        }
        this.#finalizeStop("已被强制停止 · 最后一步未保存");
    }

    async start(): Promise<boolean> {
        return await this.#startRunning();
    }

    async stop(bForce = false): Promise<boolean> {
        if (projectStore.runState === "idle") {
            return false;
        }
        if (bForce) {
            await this.forceStop();
            return true;
        }
        if (projectStore.runState === "running") {
            return this.#enterTerminating();
        }
        return false;
    }

    clearLogs = (): void => {
        log.debug("[DashboardStore] clearLogs() called");
        this.#logs = [];
    };

    togglePreserveLogs = (): void => {
        log.debug(`[DashboardStore] togglePreserveLogs() called, current=${this.#preserveLogs}`);
        this.#preserveLogs = !this.#preserveLogs;
    };

    destroy = (): void => {
        log.debug("[DashboardStore] destroy() called");
        this.#clearTimers();
    };
}

const KEY = Symbol.for('unigen.renderer.dashboardStore');
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const dashboardStore: DashboardStore = ((globalThis as any)[KEY] ??= new DashboardStore());