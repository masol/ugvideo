import { throwNotfound } from "$libs/utils/err.js";
import type { IRunnerContext } from "$types/blueprint/context.js";
import { run as runVideo } from './video/index.js';

// 根据名称加载内部流程。
export async function runInnerFlow(ctx: IRunnerContext, name: string) {
    void (ctx)
    void (name)
    switch (name) {
        case 'video':
            return runVideo(ctx);
            break;
    }
    throwNotfound(`未支持的内部工作流:${name}`, true)
}