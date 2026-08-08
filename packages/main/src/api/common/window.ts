import { throwPrecondition } from '$libs/utils/err.js';
import { WindowService } from '$libs/utils/window.js';
import { os } from "@orpc/server";
import { BrowserWindow } from 'electron';
import { z } from 'zod';
import { RpcContext } from '../type.js';

// ---------- 窗口状态枚举 ----------
const WindowStateSchema = z.object({
    isMaximized: z.boolean(),
    isMinimized: z.boolean(),
    isFullScreen: z.boolean(),
    isFocused: z.boolean(),
    isVisible: z.boolean(),
    isDestroyed: z.boolean(),
    bounds: z.object({
        x: z.number(),
        y: z.number(),
        width: z.number(),
        height: z.number(),
    }),
})

type WindowState = z.infer<typeof WindowStateSchema>

// ---------- 辅助函数 ----------
function withWindow(id: number, action: (win: BrowserWindow) => void): boolean {
    const win = BrowserWindow.fromId(id);
    if (win && !win.isDestroyed()) {
        action(win);
        return true;
    }
    return false;
}

// ---------- 最大化 ----------
const max = os
    .output(z.boolean())
    .handler(({ context }): boolean => {
        const ctx = context as RpcContext;
        return withWindow(ctx.project.wid, (win) => win.maximize());
    })

// ---------- 最小化 ----------
const min = os
    .output(z.boolean())
    .handler(({ context }): boolean => {
        const ctx = context as RpcContext;
        return withWindow(ctx.project.wid, (win) => win.minimize());
    })

// ---------- 还原 ----------
const restore = os
    .output(z.boolean())
    .handler(({ context }): boolean => {
        const ctx = context as RpcContext;
        return withWindow(ctx.project.wid, (win) => win.restore());
    })

// ---------- 显示 ----------
const show = os
    .output(z.boolean())
    .handler(({ context }): boolean => {
        const ctx = context as RpcContext;
        return withWindow(ctx.project.wid, (win) => WindowService.instance.showWindow(win));
    })

// ---------- 聚焦 ----------
const focus = os
    .output(z.boolean())
    .handler(({ context }): boolean => {
        const ctx = context as RpcContext;
        return withWindow(ctx.project.wid, (win) => win.focus());
    })

// ---------- 关闭 ----------
const close = os
    .output(z.boolean())
    .handler(({ context }): boolean => {
        const ctx = context as RpcContext;
        return withWindow(ctx.project.wid, (win) => win.close());
    })

// ---------- 获取窗口状态 ----------
const getState = os
    .output(WindowStateSchema.nullable())
    .handler(({ context }): WindowState | null => {
        const ctx = context as RpcContext;
        const win = BrowserWindow.fromId(ctx.project.wid);
        if (!win || win.isDestroyed()) {
            return null;
        }
        const bounds = win.getBounds();
        return {
            isMaximized: win.isMaximized(),
            isMinimized: win.isMinimized(),
            isFullScreen: win.isFullScreen(),
            isFocused: win.isFocused(),
            isVisible: win.isVisible(),
            isDestroyed: win.isDestroyed(),
            bounds: {
                x: bounds.x,
                y: bounds.y,
                width: bounds.width,
                height: bounds.height,
            },
        };
    })


const toggleDevtools = os
    .handler(async ({ context }) => {
        const ctx = context as RpcContext;
        const win = BrowserWindow.fromId(ctx.project.wid);
        if (win && win.webContents) {
            // 切换开发者工具的打开/关闭状态
            win.webContents.toggleDevTools();
        } else {
            throwPrecondition("无法定位窗口对象。")
        }
    });


const newwin = os
    .input(z.void())
    .output(z.boolean())
    .handler(async (): Promise<boolean> => {
        const win = await WindowService.instance.createWindow();
        if (win) {
            WindowService.instance.showWindow(win);
            return true;
        }
        return false;
    })

export default {
    max,
    min,
    restore,
    show,
    focus,
    close,
    getState,
    toggleDevtools,
    newwin,
}