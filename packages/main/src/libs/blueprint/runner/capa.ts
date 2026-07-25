import type { IRunnerContext } from '$types/blueprint/context.js';
import { RunState } from '$types/index.js';
import Logger from 'electron-log/main.js';
import { BaseRunner } from './base.js';


// 主任务执行器，维护异步状态--后台长期执行。
export class CapaRunner extends BaseRunner {
    #state: RunState = "idle";
    #running: Promise<void> | null = null;
    #ctx: IRunnerContext | null = null;
    #startTime: number = 0;

    get state(): RunState {
        return this.#state;
    }

    get startTime(): number {
        return this.#startTime;
    }

    async waitFinish(): Promise<void> {
        if (this.#running) {
            await this.#running;
            this.#running = null;
        }
        this.#ctx = null;
    }

    stop(bForce: boolean = false) {
        if (this.#state === "idle") {
            return;
        }

        if (this.#ctx) {
            this.#ctx.triggerAbort(bForce);
        }
        if (bForce) {
            // 强制模式：直接清理，让 waitFinish 立即完成
            this.#ctx = null;
            this.#running = null;
            this.#state = "idle";
        } else {
            this.#state = "terminating"
        }
    }

    start(capaId: string, ctx: IRunnerContext) {
        if (this.#state === "idle") {
            if (this.#running) {
                Logger.warn("[WorkflowRunner] 历史执行尚未执行完毕...");
                this.stop(true);
            }
            const p = this.run(capaId, ctx);
            // 错误处理：避免 unhandled rejection
            p.catch((e) => {
                Logger.error(`[CapaRunner] 执行 ${capaId} 失败:`, e);
                this.#state = "idle";
                this.#running = null;
                this.#ctx = null;
            });
            this.#running = p;
            this.#ctx = ctx;
        }
    }

    async run(capaId: string, ctx: IRunnerContext): Promise<void> {
        this.#startTime = new Date().getTime();
        this.#state = "running";
        try {
            await this.runCap(capaId, ctx);
        } finally {
            // 任何路径都清理状态，避免 #state 永驻 "running"
            this.#state = "idle";
            this.#running = null;
            this.#ctx = null;
        }
    }
}
