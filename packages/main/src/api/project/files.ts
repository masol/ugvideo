
import { os } from "@orpc/server";
import { randomUUID } from 'crypto';
import Logger from 'electron-log/main.js';
import { copy, ensureDir, pathExists } from 'fs-extra';
import { readdir, rm } from 'fs/promises';
import pMap from 'p-map';
import { extname, join } from 'path';
import { z } from 'zod';
import { RpcContext } from '../type.js';

// 项目参考图相关： @todo: 这属于video专有，应该使用tapable(hookable)将其改为插件实现！

const listMetaRes = os
    .input(z.string())
    .output(z.array(z.string()))
    .handler(async ({ input, context }) => {
        const ctx = context as RpcContext;
        const visualrefDir = ctx.project.getPath(input);
        if (await pathExists(visualrefDir)) {
            const result = await readdir(visualrefDir);
            return result.map(item => join(visualrefDir, item));
        }
        return []
    });


const addMetaRes = os
    .input(z.object({
        dir: z.string(),
        paths: z.array(z.string())
    }))
    .output(z.array(z.string()))
    .handler(async ({ input, context }) => {
        const ctx = context as RpcContext;
        const visualrefDir = ctx.project.getPath(input.dir);
        await ensureDir(visualrefDir)

        const result = await pMap(
            input.paths,
            async (src) => {
                const suffix = extname(src);
                const id = randomUUID();
                const dest = join(visualrefDir, `${id}${suffix}`)
                await copy(src, dest);
                return dest;
            },
            { concurrency: 6 }
        )
        return result;
    });


const rmMetaRes = os
    .input(z.object({
        dir: z.string(),
        paths: z.array(z.string())
    }))
    .handler(async ({ input, context }) => {
        const ctx = context as RpcContext;
        const visualrefDir = ctx.project.getPath(input.dir);
        await pMap(
            input.paths,
            async (src) => {
                if (src.startsWith(visualrefDir)) {
                    await rm(src, {
                        force: true
                    });
                } else {
                    Logger.error(`[Project VisualRef] 请求删除参考图${src},但是它不位于项目素材目录${visualrefDir}中，忽略请求。`)
                }
            },
            { concurrency: 6 }
        )
    });



const getURL = os
    .input(z.string())
    .output(z.string())
    .handler(async ({ input, context }) => {
        const ctx = context as RpcContext;
        const fullPath = ctx.project.getPath(input, true);
        return `appfile://${fullPath}`
    });


export default {
    listMetaRes,
    addMetaRes,
    rmMetaRes,
    getURL,
}