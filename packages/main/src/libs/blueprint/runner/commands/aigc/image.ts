import { getSmartImage } from "$libs/model/index.js";
import type { IRunnerContext } from "$types/blueprint/context.js";
import { generateImage } from "ai";
import dayjs from "dayjs";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { AIGC_TEMP_DIR } from "./const.js";

export async function imageAIGC(ctx: IRunnerContext): Promise<void> {
    const body = ctx.cmd.body?.trim() ?? "";
    const args = ctx.cmd.args ?? {};

    const opts: Record<string, unknown> = {};

    if (args.size) {
        opts.size = args.size
    }

    const { image } = await generateImage({
        model: getSmartImage(undefined, ctx),
        prompt: body,
        providerOptions: {
            bytedance: {
                disable_watermark: true,   // 关闭水印
            },
        },
        ...opts
    })

    const stem = dayjs().format("YYYYMMDD_HHmmss_SSS");
    const filename = `aigc_${stem}.jpg`;
    const absDir = path.join(ctx.prj.path, AIGC_TEMP_DIR);
    const absPath = path.join(absDir, filename);

    await mkdir(absDir, { recursive: true });
    await writeFile(absPath, image.uint8Array);


    ctx.notify("show-asset", `appfile://${absPath}`);
    ctx.info(`[aigc image] ${filename} (${image.uint8Array.length} bytes)`);
    ctx.notify("", `![Render Result](appfile://${absPath})`);
}
