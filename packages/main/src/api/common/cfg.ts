/* eslint-disable @typescript-eslint/no-explicit-any */
import { configService } from '$libs/store/index.js'
import { secondConfig } from '$libs/store/second.js'
import { getTheme, resetTheme, setTheme } from '$libs/store/theme.js'
import { dataCenter } from '$libs/utils/sys/data.js'
import { embedingPath, rerankPath } from '$libs/utils/sys/dir.js'
import { recentProjectSchema } from '$types/shared/api/recents.js'
import { GetThemeSchema } from '$types/shared/api/theme.js'
import { os } from '@orpc/server'
import { nativeTheme } from 'electron'
import FastGlob from 'fast-glob'
import { ensureDir } from 'fs-extra'
import { basename } from 'path'
import { z } from 'zod'

/**
 * 获取整个配置对象
 */
const getAll = os
    .output(z.record(z.string(), z.unknown()))
    .handler(async () => {
        return configService().getAll() as unknown as Record<string, unknown>
    })

/**
 * 覆盖重写整个配置
 * schema 校验失败时异常直接上抛，由调用者处理
 */
const setAll = os
    .input(z.record(z.string(), z.unknown()))
    .output(z.boolean())
    .handler(async ({ input }) => {
        configService().setAll(input as any)
        return true
    })

/**
 * 获取单个配置项
 * 返回 unknown，由调用者自行断言类型
 */
const get = os
    .input(z.object({ key: z.string() }))
    .output(z.unknown())
    .handler(async ({ input }) => {
        const { key } = input
        return configService().get(key as any)
    })

/**
 * 设置单个配置项
 * schema 校验失败时异常直接上抛，由调用者处理
 */
const set = os
    .input(z.object({ key: z.string(), value: z.unknown() }))
    .output(z.boolean())
    .handler(async ({ input }) => {
        const { key, value } = input
        configService().set(key as any, value as any)
        return true
    })


/**
 * 获取最近项目列表
 * schema 校验失败时异常直接上抛，由调用者处理
 */
const recents = os
    .input(z.union([z.boolean(), z.string()]).optional())
    .output(z.array(recentProjectSchema))
    .handler(async ({ input }) => {
        if (typeof input === 'boolean' && input === true) {
            secondConfig().clearRecents();
        } else if (typeof input === 'string' && input.length > 0) {
            secondConfig().removeProject(input);
        }
        return secondConfig().recents;
    })

/**
 * 读取当前系统是否启用了dark/light.
 */
const useDark = os
    .output(z.boolean())
    .handler(async () => {
        return nativeTheme.shouldUseDarkColorsForSystemIntegratedUI
    })

async function getModels(basepath: string): Promise<Array<{ value: string, label: string }>> {
    await ensureDir(basepath);
    const files = await FastGlob(FastGlob.convertPathToPattern(basepath) + '/**/*.gguf', {
        absolute: true
    })
    return files.map(f => {
        return {
            value: f,
            label: basename(f)
        }
    })
}

const getEmbedings = os
    .output(z.array(z.object({
        value: z.string(),
        label: z.string()
    })))
    .handler(async () => {
        return getModels(embedingPath());
    })

const getReranks = os
    .output(z.array(z.object({
        value: z.string(),
        label: z.string()
    })))
    .handler(async () => {
        return getModels(rerankPath());
    })

const setheme = os
    .input(z.string())
    .output(z.string())
    .handler(async ({ input }) => {
        return setTheme(input);
    })


const resetheme = os
    .handler(async () => {
        resetTheme();
    })

const getheme = os
    .output(GetThemeSchema)
    .handler(async () => {
        return getTheme();
    })

const readData = os
    .input(z.string())
    .output(z.string().nullable())
    .handler(async ({ input }) => {
        return dataCenter.readFile(input);
    })

export default {
    getAll,
    setAll,
    get,
    set,
    useDark,
    getEmbedings,
    getReranks,
    recents,
    setTheme: setheme,
    resetTheme: resetheme,
    getTheme: getheme,
    readData
}