import { throwNotfound } from "$libs/utils/err.js";
import { compile } from '$libs/weave/index.js';
import type { IRunnerContext } from "$types/blueprint/context.js";
import { run as runMain } from './main/index.js';
import { run as runProd2adimg } from './prod2adimg/run.js';
import { run as runVideo } from './video/index.js';

// 根据名称加载内部流程。
export async function runInnerFlow(ctx: IRunnerContext, name: string) {
    void (ctx)
    void (name)
    switch (name) {
        case 'video':
            return await runVideo(ctx);
        case 'prod2adimg':
            return await runProd2adimg(ctx);
        case 'weave':
            return await compile(ctx);
        case 'main':
            return await runMain(ctx);
    }
    throwNotfound(`未支持的内部工作流:${name}`, true)
}