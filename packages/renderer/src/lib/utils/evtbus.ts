// evtbus.ts
import type { AppConfig, RecentProject, WindowEventPayload } from '@app/main/types';
import mitt, { type Emitter } from "mitt";

/**
 * 1. 在这里定义你的事件映射类型
 *  key: 事件名（推荐用命名空间，如 "user:login"）
 *  value: 该事件对应的 payload 类型（void 表示无参数）
 */
export type Events = {
    "winstate": WindowEventPayload;
    "cfg:setall": AppConfig;
    "cfg:set": { name: string; value: unknown };
    "sys:usedark": boolean  // 更改了操作系统的深色/浅色模式。
    "lang:changed": string  // 更新了语言设置。
    "task_finished": { success: boolean, reason?: string, seq: number } // 任务结束，启动时间。
    "task_progess_report": string // 项目主任务进度报告。
    "runcommand-end": { suc: boolean, seq: number }
    "recent:projects": RecentProject[]
    "kv-changed": { key: string, value: unknown }
    "before-input-evt": {
        key: string;
        ctrlKey: boolean;
        metaKey: boolean;
        shiftKey: boolean;
        altKey: boolean;
    }
};

export type EventNameType = keyof Events;

/**
 * 2. 内部包装类：封装底层 mitt 的操作
 */
class EventBus {
    private _emitter: Emitter<Events> = mitt<Events>();

    on<K extends keyof Events>(event: K, handler: (payload: Events[K]) => void) {
        this._emitter.on(event, handler);
    }

    once<K extends keyof Events>(event: K, handler: (payload: Events[K]) => void) {
        let called = false;
        const wrapped: typeof handler = (payload) => {
            if (called) return;
            called = true;
            handler(payload);
            this._emitter.off(event, wrapped);
        };
        this._emitter.on(event, wrapped);
    }

    off<K extends keyof Events>(event: K, handler: (payload: Events[K]) => void) {
        this._emitter.off(event, handler);
    }

    offAll<K extends keyof Events>(event: K) {
        this._emitter.off(event);
    }

    emit<K extends keyof Events>(event: K, payload: Events[K]) {
        this._emitter.emit(event, payload);
    }
}

/**
 * 3. 基于 Symbol.for 的全局单例挂载
 */
const KEY = Symbol.for('unigen.renderer.evtbus');

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const evtbus: EventBus = ((globalThis as any)[KEY] ??= new EventBus());

export type Evtbus = EventBus;

export default evtbus;