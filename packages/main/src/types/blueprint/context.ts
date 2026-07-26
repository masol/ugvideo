import { ICapaFunctor } from "$libs/blueprint/capability/type.js";
import type { IProjectContext } from "$libs/project/type.js";
import type { Capability } from "./capability.js";


export interface CommandInfo {
    isCommand: boolean;
    command?: string;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    args?: Record<string, any>;
    body: string;
}

export interface IRunnerContext {
    /** 原生的 Web API AbortSignal，可透传给支持取消的异步底层操作 */
    readonly signal: AbortSignal;
    // 默认的调用序列，用来指示本次runcontext的标识--这个标识只在进程内唯一(用户指定正向增加，内部分配负向减少)
    readonly seq: number;

    readonly store: Record<string, unknown>;

    /** 快照检查点：判断当前工作流是否已经被终止 */
    readonly isAborted: boolean;

    /** 快照检查点：判断是否属于“强制杀死”状态 */
    readonly isForceKilled: boolean;
    readonly prj: IProjectContext;
    cmd: CommandInfo;
    readonly stack: Capability[]; // 指示当前调用栈--主要服务于目标跟踪及拆解。

    push(cap: Capability): void;
    pop(): Capability | null;
    /**
     * 内部或外部触发取消的方法（配合宿主环境使用）
     * @param force 是否属于强制杀死
     */
    triggerAbort(force?: boolean): void;


    /**
     * 加载特定能力id对应的执行对象。
     * @param capaId capability id.
     */
    loadFunctor(capaId: string): ICapaFunctor | null


    // ==========================================
    // 📝 日志接口 (适配 electron-log)
    // ==========================================
    /**
     * 向渲染端主界面发送通知，以报告关键进度和细节--只显示一个，不会树状显示。
     * @param message 
     * @param args 
     */
    notify(title: string, detail: string): void


    /**
     * 打印普通信息日志
     * @param message 日志文本
     * @param args 类似 console.log 的后续动态参数
     */
    info(message: string, ...args: unknown[]): void;

    /**
     * 打印警告日志
     */
    warn(message: string, ...args: unknown[]): void;

    /**
     * 打印错误日志
     */
    error(message: string, ...args: unknown[]): void;

    /**
     * 打印调试日志
     */
    debug(message: string, ...args: unknown[]): void;
}
