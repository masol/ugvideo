import { PrjDB } from '$libs/project/controllers/drizzle/index.js';
import { IProjectContext } from '$libs/project/type.js';
import { CommandInfo, IRunnerContext } from '$types/blueprint/context.js';
import log from 'electron-log/main.js';
import { loadFunctor } from './capability/index.js';
import type { Capability } from './capability/is.js';
import { ICapaFunctor } from './capability/type.js';

let runSeq: number = -1;

export class RunnerContext implements IRunnerContext {
    readonly signal: AbortSignal;
    readonly prj: IProjectContext;
    readonly prjdb: PrjDB;
    readonly seq: number;
    readonly store: Record<string, unknown> = {};

    cmd: CommandInfo = { isCommand: false, body: "" };
    fnNotify: ((title: string, detail: string) => void) | null = null;
    #stack: Capability[] = [];

    private readonly abortController: AbortController | null = null;
    #isForceKilled: boolean = false;

    constructor(prj: IProjectContext, signal?: AbortSignal | null, seq?: number) {
        this.seq = seq ? seq : runSeq--;
        this.prj = prj;
        this.prjdb = PrjDB.ensure(prj);

        // 初始化原生的 AbortController
        if (signal) {
            this.signal = signal;
        } else {
            this.abortController = new AbortController();
            this.signal = this.abortController.signal;
        }

        // 配置 electron-log 的作用域 (Scope)
        // 这样该工作流实例的所有日志都会自动带上 [workflow-id] 前缀，方便排查问题
        log.scope(`workflow-${this.prj.path}`);
    }

    push(cap: Capability): void {
        this.#stack.push(cap);
    }

    pop(): Capability | null {
        if (this.#stack.length === 0) {
            return null;
        }
        return this.#stack.pop() ?? null;
    }

    // ==========================================
    // 🚦 状态检查点
    // ==========================================

    /** 快照检查点：判断当前工作流是否已经被终止 */
    get isAborted(): boolean {
        return this.signal.aborted;
    }

    get stack(): Capability[] {
        return this.#stack;
    }

    /** 快照检查点：判断是否属于“强制杀死”状态 */
    get isForceKilled(): boolean {
        return this.#isForceKilled;
    }

    /**
     * 内部或外部触发取消的方法（配合宿主环境使用）
     * @param force 是否属于强制杀死
     */
    triggerAbort(force: boolean = false): void {
        if (force) {
            this.#isForceKilled = true;
        }
        if (this.abortController) {
            this.abortController.abort();
            this.warn(`Workflow execution was aborted. ForceKilled: ${force}`);
        } else {
            this.warn(`Workflow execution want abort. but this runner controlled by outer.`);
        }
    }

    set(key: string, value: unknown): void {
        this.prjdb.set(key, value);
    }

    get<T>(key: string): T | null {
        return this.prjdb.get<T>(key);
    }

    remove(key: string): void {
        this.prjdb.remove(key);
    }

    loadFunctor(capaId: string): ICapaFunctor | null {
        return loadFunctor(this, capaId);
    }


    // ==========================================
    // 📝 日志接口 (适配 electron-log) 
    //  @TODO: 适配通知接口，以通知主进程的日志过程。(是否应该取名step?)
    // ==========================================
    notify(title: string, detail: string): void {
        if (this.fnNotify) {
            this.fnNotify(title, detail);
        } else {
            this.prj.notify("task_progess_report", {
                title,
                detail
            });
            // log.silly(arg);
        }
    }

    info(message: string, ...args: unknown[]): void {
        log.info(message, ...args);
    }

    warn(message: string, ...args: unknown[]): void {
        log.warn(message, ...args);
    }

    error(message: string, ...args: unknown[]): void {
        log.error(message, ...args);
    }

    debug(message: string, ...args: unknown[]): void {
        log.debug(message, ...args);
    }
}
