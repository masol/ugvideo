// $lib/store/dashboard.svelte.ts
// 私有 store：所有状态、衍生值、副作用、对外回调都集中在这里。
// 子组件通过只读 getter 消费，通过调用方法修改，完全不持有本地状态。
import { projectStore } from "$lib/store/project.svelte";
import { confirmStore } from "$lib/store/ui/confirm.svelte";
import { api, safeApi } from "$lib/utils/api";
import evtbus from "$lib/utils/evtbus";
import { hooks } from "$lib/utils/hook";
import type { RunState } from "@app/main/types";
import log from "electron-log/renderer";
import { getErrorMessage } from "radashi";
import { toast } from "svelte-sonner";

// ─── 类型 ───────────────────────────────────────────────────────
interface LogEntry {
    id: string;
    time: number; // 时间戳（毫秒）
    message: string;
}

// ─── Store ──────────────────────────────────────────────────────
class DashboardStore {
    // ── 私有状态（精确选型）──────────────────────────────────────
    #elapsedSeconds = $state(0);
    #terminatingSeconds = $state(0);
    #logs = $state.raw<LogEntry[]>([]);
    #target = $state<string>("post");
    #preserveLogs = $state(false); // 是否保留日志（跨任务重启）
    forceShowLog = $state(false);

    // ── 运行标识（非响应式，仅用于控制流 / 状态守卫）─────────────
    // #seqCounter：单调递增的 call sequence 生成器。
    // #activeSeq：当前我们“拥有”的这次运行的 seq；空闲时为 null。
    //   task_finished 只会被 seq 匹配的那一次运行处理，杜绝旧任务的迟到事件。
    // #terminationRequested：本次运行是否已发出过终止信号（保证只响应一次终止）。
    #seqCounter = 0;
    #activeSeq: number | null = null;
    #terminationRequested = false;

    // ── 私有非响应式资源 ─────────────────────────────────────────
    #clockTimer: ReturnType<typeof setInterval> | null = null;
    #terminateTimer: ReturnType<typeof setInterval> | null = null;

    // ── 派生 ─────────────────────────────────────────────────────
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

        // 监听任务进度报告
        evtbus.on("task_progess_report", (message: string) => {
            this.#pushLog(message);
        });

        // 监听任务完成事件。
        // seq 由启动时传入并原样回传；只处理与 #activeSeq 匹配的那一次运行，
        // 其余（迟到的旧任务事件、未由本 store 发起的运行）一律忽略。
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

            // 该次运行到此结束：先让出所有权，任何后续同 seq 事件都将被忽略。
            this.#releaseRun();

            // 添加完成日志
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
                // toast.success(msg);
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
                // toast.error(msg);
            }
        });

        hooks.hook("project:loaded", async () => {
            // 新项目已打开，清空旧数据。重新加载必要的内容。
            this.#target = await safeApi().project.get("target");
            if (!this.#target && projectStore.activity) {
                const targetSize = projectStore.activity.targets.length;
                this.#target = `${targetSize}/${targetSize}`
            }
            this.#releaseRun();
        })
    }

    // ── 只读门面 ─────────────────────────────────────────────────
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

    // ── 运行标识工具 ─────────────────────────────────────────────
    // 事件是否属于当前活跃运行：seq 必须存在且严格等于 #activeSeq。
    // 未携带 seq（undefined）的事件不被认领——避免误吞非本 store 发起的运行结果。
    #isOwnedEvent(seq: number | undefined): boolean {
        return seq !== undefined && seq === this.#activeSeq;
    }

    // 让出当前运行所有权并停表；幂等，重复调用安全。
    #releaseRun() {
        this.#activeSeq = null;
        this.#terminationRequested = false;
        this.#clearTimers();
        this.#elapsedSeconds = 0;
        this.#terminatingSeconds = 0;
    }

    // ── 工具 ─────────────────────────────────────────────────────
    #pushLog(message: string) {
        // 新日志插入在数组头部（最新在上）
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

    // ── 状态机 ───────────────────────────────────────────────────
    async #startRunning(): Promise<boolean> {
        // 严格守卫：必须真正空闲，且当前没有被认领的运行。
        // 双重条件杜绝“已开始的项目再次开始”，也防止并发点击重入。
        if (projectStore.runState !== "idle" || this.#activeSeq !== null) {
            log.debug(
                `[DashboardStore] startRunning() rejected: runState=${projectStore.runState}, activeSeq=${this.#activeSeq ?? "null"}`,
            );
            return false;
        }

        // 立即认领本次运行，占住 seq，防止 await 期间的重入。
        const seq = ++this.#seqCounter;
        this.#activeSeq = seq;
        this.#terminationRequested = false;
        // this.forceShowLog = false; // 必须用户明确关闭日志，否则一直处于强制显示日志状态。
        log.debug(`[DashboardStore] startRunning() called, seq=${seq}`);

        // 如果未勾选“保留日志”，则清空历史日志（在真正启动前）。
        if (!this.#preserveLogs) {
            this.#logs = [];
        }

        try {
            await projectStore.start(seq, true);
        } catch (err) {
            // 启动失败：回滚所有权，避免 store 卡在“已认领但未运行”的悬空态。
            log.error("[DashboardStore] projectStore.start() failed", err);
            if (this.#activeSeq === seq) {
                this.#releaseRun();
            }
            return false;
        }

        // await 期间可能已被更新的运行取代，或本次已经完成/终止。
        // 只有仍持有本 seq 时才继续布置计时器。
        if (this.#activeSeq !== seq) {
            log.debug(`[DashboardStore] startRunning() superseded, seq=${seq}`);
            return false;
        }

        // 任务可能瞬时结束：以真实 runState 为准，避免给已结束的任务开表。
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
        // 只响应一次终止：本次运行已请求过终止则直接返回。
        if (this.#terminationRequested) {
            log.debug("[DashboardStore] enterTerminating() ignored: already requested");
            return false;
        }
        // 必须处于“运行中”且由本 store 拥有，才允许发出终止。
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

    // ── 对外方法（子组件调用，箭头字段确保 this 绑定）──────────────
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
        // 仅在仍持有一次运行时才允许强停，防止对已结束任务的重复终止。
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

        // 确认期间该运行可能已自然结束或被更替，重新校验所有权。
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
