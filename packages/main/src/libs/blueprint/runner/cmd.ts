import { runInnerFlow } from '$libs/innerflow/index.js';
import { PrjDB } from '$libs/project/controllers/drizzle/index.js';
import { ProjectDbKeys } from '$libs/utils/db/dbkeys.js';
import { throwPrecondition } from '$libs/utils/err.js';
import { delay } from '$libs/utils/promise.js';
import type { CommandInfo, IRunnerContext } from '$types/blueprint/context.js';
import { SpanStatusCode } from '@opentelemetry/api';
import { parse, ParseEntry } from 'shell-quote';
import yargsParser from 'yargs-parser';
import { BaseRunner, withSpan } from './base.js';
import { runCmd as doAIGC } from './commands/aigc/index.js';
import { runCmd as doExport } from './commands/export/runCmd.js';
import { runCmd as doKV } from './commands/kv.js';
import { runCmd as doPlan } from './commands/plan/index.js';
import { runCmd as doPreprism } from './commands/preprism.js';
import { runCmd as doPrism } from './commands/prism.js';
import { runCmd as doRun } from './commands/run.js';

/**
 * 安全地将 shell-quote 的每一项还原为字符串
 */
function stringifyToken(token: string | ParseEntry): string {
    if (typeof token === 'string') return token;
    if ('pattern' in token) return token.pattern;   // 处理 Glob 模式 (如 *.js)
    if ('op' in token) return token.op;             // 处理控制符 (如 |, &&)
    if ('comment' in token) return `#${token.comment}`; // 处理注释
    return '';
}

export function parseCommandWithBody(userInput: string): CommandInfo {
    const trimmed = userInput.trim();

    // 1. 严格校验：只要以 / 开头就绝对是命令
    if (!trimmed.startsWith('/')) {
        return { isCommand: false, body: trimmed };
    }

    // 2. 利用 shell-quote 解析长文本/多行文本
    const tokens = parse(trimmed);

    // 3. 提取首位的命令，并安全地移除开头的斜杠 '/'
    const rawCommand = tokens.shift();
    if (!rawCommand) {
        return { isCommand: true, command: '', args: {}, body: '' };
    }
    const commandStr = stringifyToken(rawCommand);
    const command = commandStr.startsWith('/') ? commandStr.slice(1) : commandStr;

    // 4. 寻找参数的“终止边界”
    let bodyStartIndex = tokens.length;

    for (let i = 0; i < tokens.length; i++) {
        const tokenStr = stringifyToken(tokens[i]);
        const prevTokenStr = i > 0 ? stringifyToken(tokens[i - 1]) : '';

        // 判定边界：如果碰到了不以 - 开头的长文本（包含换行，或者是普通文本）
        // 且它不像是紧跟在参数名（如 --model）之后的简单参数值，就判定为 body 的起点
        if (
            !tokenStr.startsWith('-') &&
            (tokenStr.includes('\n') || tokenStr.length > 20 || i === tokens.length - 1 || !prevTokenStr.startsWith('-'))
        ) {
            bodyStartIndex = i;
            break;
        }
    }

    // 5. 切分出参数数组和 Body 数组
    const argsTokens = tokens.slice(0, bodyStartIndex);
    const bodyTokens = tokens.slice(bodyStartIndex);

    // 6. 转化参数为键值对对象
    const argsStrings = argsTokens.map(stringifyToken);
    const fullParsedArgs = yargsParser(argsStrings);

    // 💡 修复位置：使用解构赋值剔除 '_' 属性，将剩余的参数存入 cleanArgs 中
    const { _, ...cleanArgs } = fullParsedArgs;

    // 7. 还原 body 文本
    const bodyText = bodyTokens.map(stringifyToken).join(' ');

    return {
        isCommand: true,
        command,
        args: cleanArgs, // 👈 这里是已经剔除了 '_' 且符合 Record<string, any> 的干净对象
        body: bodyText.trim()
    };
}

// 命令执行器。解析命令字符串并加以执行。
export class CmdRunner extends BaseRunner {
    private async runCmdEntry(ctx: IRunnerContext) {
        const kvKey4cap = `entry_${ctx.cmd.command}`;
        const prjdb: PrjDB = PrjDB.ensure(ctx.prj);
        const capId = prjdb.get<string>(kvKey4cap);
        if (!capId) {
            throwPrecondition(`请求执行命令"${ctx.cmd.command ?? ""}"，但是未能发现对应${kvKey4cap}的入口定义，请自行编辑术语表，添加此入口。`)
        }
        return await this.runCap(capId, ctx);
    }

    // 仅供flow.runCommand调用。
    async dispatch(ctx: IRunnerContext): Promise<void> {
        switch (ctx.cmd.command) {
            case 'export':
                await doExport(ctx);
                break;
            case 'plan':
                await doPlan(ctx);
                break;
            case 'prism':
                await doPrism(ctx);
                break;
            case 'preprism':
                await doPreprism(ctx);
                break;
            case 'run':
                await doRun(ctx);
                break;
            case 'kv':
                await doKV(ctx);
                break;
            case 'aigc':
                await doAIGC(ctx);
                break;
            case 'test':
                await delay(10000, ctx.signal);
                break;
            default:
                return await this.runCmdEntry(ctx);
        }
    }

    async run(userInput: string, ctx: IRunnerContext): Promise<void> {
        const cmdInfo = parseCommandWithBody(userInput);
        ctx.cmd = cmdInfo;
        const prjdb: PrjDB = PrjDB.ensure(ctx.prj);
        if (!cmdInfo.isCommand) {
            const capId = prjdb.get<string>(ProjectDbKeys.entry_common);
            if (!capId) {
                return await runInnerFlow(ctx,"main")
            }
            return await this.runCap(capId, ctx);
        }
        return withSpan(`CmdRunner.run`, async (span) => {
            span.setAttribute("command.userInput", userInput);
            span.addEvent("task_started", { message: `开始分遣命令: ${ctx.cmd.command}` });
            await this.dispatch(ctx);
            span.addEvent("command_run_success");
            span.setStatus({ code: SpanStatusCode.OK });
        });
    }
}