import { CmdRunner } from "$libs/blueprint/runner/cmd.js";
import { runInnerFlow } from "$libs/innerflow/index.js";
import type { CommandInfo, IRunnerContext } from "$types/blueprint/context.js";

async function runCommand(ctx: IRunnerContext, cmd: string, args?: Record<string, unknown>): Promise<void> {
    // 通过 `= {}` 提供默认空对象，防止 args 为 undefined 时解构报错
    const { body, ...rest } = args || {};
    const cmdInfo: CommandInfo = {
        command: cmd,
        args: rest,
        body: body as string,
        isCommand: cmd.length > 0
    }
    const runner = new CmdRunner();
    const oldCmd = ctx.cmd;
    ctx.cmd = cmdInfo
    try {
        await runner.dispatch(ctx);
    } finally {
        ctx.cmd = oldCmd;
    }
}

export function getFlow(ctx: IRunnerContext) {
    return {
        inner: runInnerFlow.bind(null, ctx),
        cmd: runCommand.bind(null, ctx)
    } as const
};
