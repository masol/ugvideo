// 第二存储持久化池，无需备份/恢复的放在这里。

import { getCurrentProject } from '$libs/utils/api/index.js';
import { broadcast } from '$libs/utils/rpcevt.js';
import { SecondConfig } from '$types/appconfig.js';
import type { RecentProject } from '$types/index.js';
import Store from 'electron-store';
import QuickLRU from 'quick-lru';
import { secondSchema } from './second.schema.js';

type QuickLRUType = QuickLRU<string, RecentProject>;
class ConfigService {
    private store: Store<SecondConfig>;
    private lru: QuickLRUType;

    constructor(store: Store<SecondConfig>) {
        this.store = store;

        // 确保如果磁盘上的物理文件遭遇人为损坏（如变成了空文件或非法 JSON），
        // 也能在初始化时立即根据 configSchema 重置并生成一个干净、合规的默认 JSON 配置文件。
        try {
            if (!this.store.store || typeof this.store.store !== 'object') {
                this.store.clear();
            }
        } catch {
            this.store.clear();
        }

        this.lru = new QuickLRU({
            maxSize: 6,
        })
        const recents = this.get('recents');
        // 按 time 降序排序，时间小的在前
        const sortedRecents = [...recents].sort((a, b) => a.time - b.time);
        for (const recent of sortedRecents) {
            this.lru.set(recent.path, recent);
        }
    }

    private onUpdate() {
        this.set('recents', Array.from(this.lru.values()));
        const prj = getCurrentProject();

        broadcast({
            name: "recent:projects",
            srcId: prj?.wid || -1,
            payload: this.recents
        })
    }

    addProject(path: string, time: number, icon: string) {
        this.lru.set(path, {
            path,
            time,
            icon
        });
        this.onUpdate();
    }

    get recents() {
        // quick-lru 内部的迭代器是从“最老”到“最新”
        // 用 reverse() 反转，让最新打开的项目排在最前面
        // return Array.from(this.lru.values()).reverse();
        // 1. 将 LRU 缓存的值转换为数组
        const projects = Array.from(this.lru.values());

        // 2. 按 time 属性降序排序（数值大、时间新、排在前面）
        return projects.sort((a, b) => b.time - a.time);
    }

    clearRecents() {
        if (this.lru.size > 0) {
            this.lru.clear();
            this.onUpdate();
        }
    }

    removeProject(projectPath: string) {
        if (this.lru.has(projectPath)) {
            this.lru.delete(projectPath);
            this.onUpdate();
        }
    }

    /**
     * 获取整个配置对象
     * 内部会自动融合 schema 中定义的所有最新默认值
     */
    getAll(): SecondConfig {
        return this.store.store;
    }


    /**
     * 通用获取配置项方法
     * 传入的 key 必须是 AppConfig 的键，返回值会自动推导为该键对应的类型
     */
    get<K extends keyof SecondConfig>(key: K): SecondConfig[K] {
        return this.store.get(key);
    }

    /**
     * 通用设置配置项方法
     * 传入的 key 必须是 AppConfig 的键，value 的类型会被严格约束为该键对应的类型
     * 不进行内部异常捕获，若 schema 校验失败，异常将直接向上抛出由外部处理
     */
    set<K extends keyof SecondConfig>(key: K, value: SecondConfig[K]): void {
        this.store.set(key, value);
    }
}

const KEY = Symbol.for('unigen.singleton.secondConfig');
/**
 * 获取 ConfigService 单例实例
 */
export const secondConfig = (): ConfigService => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const g = globalThis as any;
    if (!g[KEY]) {
        g[KEY] = new ConfigService(new Store<SecondConfig>({
            schema: secondSchema,
            name: 'second',
        }));
    }
    return g[KEY] as ConfigService;
};
