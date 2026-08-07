// agic.ts
import { throwNotimplement, throwUnprcessable } from '$libs/utils/err.js';
import type { IRunnerContext } from '$types/blueprint/context.js';
import { imageAIGC } from './image.js';
import { textAIGC } from './text.js';
import { videoAIGC } from './video.js';

export async function runCmd(ctx: IRunnerContext): Promise<void> {
    const body = ctx.cmd.body?.trim();
    if (!body) {
        throwUnprcessable("请求 agic 但未提供任何内容。用法: /agic [--type text|image|video|tts|asr|bgm|mt] <prompt>");
    }

    const args = ctx.cmd.args ?? {};
    const allowed = ['text', 'image', 'video', 'tts', 'asr', 'bgm', 'mt'];

    const type = args['type'] ?? "text";

    // 指定生成类型 (若未提供则默认自动推理或仅文本)
    if (args['type']) {
        if (!allowed.includes(args['type'])) {
            throwUnprcessable(`不支持的生成类型: ${args['type']}，可选: ${allowed.join(', ')}`);
        }
    }

    ctx.notify("生成中", `${type} Agic 正在处理，请稍候...`);

    switch (type) {
        case 'text':
            await textAIGC(ctx);
            break;
        case 'image':
            await imageAIGC(ctx);
            break;
        case 'video':
            await videoAIGC(ctx);
            break;
        default:
            throwNotimplement(`尚未实现"${type}"类型的AICG执行。`)
    }
}