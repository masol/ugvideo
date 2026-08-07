import { getSmartVideo } from "$libs/model/index.js";
import type { IRunnerContext } from "$types/blueprint/context.js";
import { experimental_generateVideo as generateVideo } from "ai";
import dayjs from "dayjs";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { AIGC_TEMP_DIR } from "./const.js";

export async function videoAIGC(ctx: IRunnerContext): Promise<void> {
    const body = ctx.cmd.body?.trim() ?? "";
    const args = ctx.cmd.args ?? {};

    const opts: Record<string, unknown> = {
        duration_seconds: parseInt(args.duration ?? "1"),
        resolution: args.size || "480p"
    };


    const { video } = await generateVideo({
        model: getSmartVideo(undefined, ctx),
        prompt: body,
        providerOptions: {
            bytedance: {
                disable_watermark: true,   // 关闭水印
            },
        },
        ...opts
    })

    const stem = dayjs().format("YYYYMMDD_HHmmss_SSS");
    const filename = `aigc_${stem}.mp4`;
    const absDir = path.join(ctx.prj.path, AIGC_TEMP_DIR);
    const absPath = path.join(absDir, filename);

    await mkdir(absDir, { recursive: true });
    await writeFile(absPath, video.uint8Array);

    ctx.notify("show-asset", `appfile://${absPath}`);

    ctx.info(`[aigc video] ${filename} (${video.uint8Array.length} bytes)`);
    ctx.notify("", `${absPath}`);
}
