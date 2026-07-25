import { createHooks, type Hookable } from 'hookable';

// 1. 定义你的事件和 payload 类型映射
interface UnigenHooks {
    // 打开项目时调用插件的hook函数，确保调用之前，插件已经被加载完毕。
    'project:loaded': (payload: { path: string }) => void | Promise<void>;
    'project:closed': (payload: void) => void | Promise<void>;
}

export type UnigenHookType = Hookable<UnigenHooks>

// 2. 将类型传入 createHooks 泛型中
const KEY = Symbol.for('unigen.renderer.hooks');
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const hooks: UnigenHookType = ((globalThis as any)[KEY] ??= createHooks<UnigenHooks>());