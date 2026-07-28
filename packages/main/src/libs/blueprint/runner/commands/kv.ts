import { PrjDB } from "$libs/project/controllers/drizzle/index.js";
import { throwUnprcessable } from "$libs/utils/err.js";
import type { IRunnerContext } from "$types/blueprint/context.js";

export async function runCmd(ctx: IRunnerContext): Promise<void> {
    const prjdb = PrjDB.ensure(ctx.prj);
    const args = ctx.cmd.args || {};

    const body = ctx.cmd.body;
    if (!body || body.split('\n').length > 1) {
        throwUnprcessable("未传入请求处理的kv节点[通配符]");
    }

    if (args.rm || args.del || args.remove) {
        prjdb.removeByGlob(body);
        ctx.notify("", `已成功删除${body}`)
    } else if (args.list || args.ls) {
        const results = prjdb.getByGlob(body);
        const ret = `# 符合通配符${body}的KV项有${results.length}个:\n\n
${results.map(r => `* ${r}`).join('\n')}`
        ctx.notify("", ret);
    } else {
        throwUnprcessable("未被支持的子命令。")
    }
}