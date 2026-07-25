import { RunnerContext } from "$libs/blueprint/context.js";
import { CapaRunner, CmdRunner } from "$libs/blueprint/runner/index.js";
import { configService } from "$libs/store/index.js";
import { throwPrecondition } from "$libs/utils/err.js";
import { appLife } from "$libs/utils/tapable/applife.js";
import type { RunState } from "$types/index.js";
import Logger from "electron-log/main.js";
import { getErrorMessage } from "radashi";
import { ProjectDbKeys } from "../../utils/db/dbkeys.js";
import type { IProjectContext } from "../type.js";
import { BaseProjectController } from "./base.js";
import { PrjDB } from "./drizzle/index.js";




export class PrjRunner extends BaseProjectController {
    static readonly serviceKey = Symbol.for('project.controller.PrjRunner');
    #runner: CapaRunner;
    #cmdrunner: CmdRunner | null = null;

    constructor(ctx: IProjectContext) {
        super(ctx)
        this.#runner = new CapaRunner();
        // 监听 beforeQuit，强制停止运行中的任务
        appLife.hooks.beforeQuit.tapPromise('PrjRunner', async () => {
            Logger.debug('[PrjRunner] 正在停止运行中的任务...');
            if (this.#runner.state === 'running' || this.#runner.state === 'terminating') {
                this.#runner.stop(true);   // 强制停止
            }
            await this.#runner.waitFinish();
            Logger.debug('[PrjRunner] 任务已停止。');
        });
    }
    static ensure(ctx: IProjectContext): PrjRunner { return this.coreEnsure(this, ctx); }

    get runState(): RunState {
        return this.#runner ? this.#runner.state : 'idle';
    }

    get startTime(): number {
        return this.#runner ? this.#runner.startTime : 0;
    }

    async waitFinish(): Promise<void> {
        return this.#runner.waitFinish();
    }

    // 执行一个命令。
    async runCommand(command: string, fnNotify: ((title: string, detail: string) => void) | null, signal?: AbortSignal | null): Promise<void> {
        if (this.#cmdrunner) {
            throwPrecondition("已经有一个命令在执行中，每个项目只能并行执行一个命令。并行命令，请自行撰写代码能力，并执行之。")
        }
        const ctx = new RunnerContext(this.ctx, signal);
        ctx.fnNotify = fnNotify;
        try {
            this.#cmdrunner = new CmdRunner();
            await this.#cmdrunner.run(command, ctx)
        } catch (e) {
            const msg = `## 命令执行错误： 
${getErrorMessage(e)}`;
            if (fnNotify) {
                fnNotify("error", msg);
            }
            // Logger.error(msg)
        } finally {
            this.#cmdrunner = null;
            ctx.fnNotify = null;
        }
    }

    start(entry?: string, seq?: number): void {
        if (this.#cmdrunner) {
            const parallelRun = configService().get("parallelRun");
            if (!parallelRun) {
                throwPrecondition("有工作流改进任务在执行中，如果期望改进任务与工作流可以同步执行，在开发中启用并行执行。")
            }
        }
        const prjdb = PrjDB.ensure(this.ctx);
        if (!entry) {
            const defEntry = prjdb.get<string>(ProjectDbKeys.entry_capa);
            if (!defEntry) {
                throwPrecondition("项目未指定默认启动的能力ID，也没有给出能力ID.")
            }
            entry = defEntry;
        }

        const ctx = new RunnerContext(this.ctx, null, seq);
        this.#runner.start(entry, ctx);
    }

    stop(bForce: boolean): void {
        this.#runner.stop(bForce);
    }
}