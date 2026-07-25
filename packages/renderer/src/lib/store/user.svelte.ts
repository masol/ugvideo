// src/lib/store/user.svelte.ts
//═══════════════════════════════════════════════════════════════
//UserStore — 用户/会话管理全局单例
//  基于 Svelte 5 Runes + Class 风格 + 防御性设计
// ═══════════════════════════════════════════════════════════════

// import { api } from '$lib/utils/api';
import Logger from 'electron-log/renderer.js';

//─── 类型定义 ─────────────────────────────────────────────────

/** 用户资料接口 */
export interface UserProfile {
    readonly id: number;
    username: string;
    email: string;
    avatar: string;
    role: 'admin' | 'user' | 'guest';
    readonly createdAt: Date;
}

/** 登录凭证 */
export interface LoginCredentials {
    username: string;
    password: string;
}

/** 异步操作的生命周期状态（可复用类型） */
export interface AsyncLifecycle {
    readonly isLoading: boolean;
    readonly error: string | null;
    readonly lastUpdated: Date | null;
}

// ─── Store 类 ─────────────────────────────────────────────────

class UserStore {
    // ━━━ 私有响应式状态（外部不可直接写入） ━━━━━━━━━━━━━━━━━━━
    #user: UserProfile | null = $state(null);
    #isLoading: boolean = $state(false);
    #error: string | null = $state(null);
    #lastUpdated: Date | null = $state(null);

    // ━━━ 派生状态 ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    /** 派生：用户是否已登录 */
    readonly isLoggedIn: boolean = $derived(this.#user !== null);

    /** 派生：用于UI 展示的用户名（未登录时显示占位） */
    readonly displayName: string = $derived(
        this.#user ? this.#user.username : 'Guest'
    );

    // ━━━ 只读访问器（唯一的对外数据出口） ━━━━━━━━━━━━━━━━━━━━
    get user(): UserProfile | null {
        return this.#user;
    }

    get isLoading(): boolean {
        return this.#isLoading;
    }

    get error(): string | null {
        return this.#error;
    }

    get lastUpdated(): Date | null {
        return this.#lastUpdated;
    }

    // ━━━ 构造函数 —— 事件总线订阅中心 ━━━━━━━━━━━━━━━━━━━━━━━
    constructor() {
        // 🔔 监听外部 login 请求（其他模块可通过事件触发登录）
        // evtbus.on('user:login', (credentials: LoginCredentials) => {
        //   this.login(credentials);
        // });

        // // 🔔 监听 logout 事件 → 自动清空用户状态并重置状态机
        // evtbus.on('user:logout', () => {
        //     this.#reset();
        //     Logger.info('[UserStore] 用户已注销，状态已重置');
        // });

        // // 🔔 监听用户资料局部更新
        // evtbus.on('user:update', (patch: Partial<UserProfile>) => {
        //     this.#patchUser(patch);
        // });

        // 🔔 监听全局错误事件
        // evtbus.on('error', (message: string) => {
        //   this.#error = message;
        // });

        Logger.info('[UserStore] 单例初始化完成，事件监听已注册');
    }

    // ━━━ 异步 Action：登录 ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    async login(credentials: LoginCredentials): Promise<void> {
        // 防止重复提交
        if (this.#isLoading) {
            console.warn('[UserStore] 登录请求进行中，忽略重复调用');
            return;
        }

        this.#isLoading = true;
        this.#error = null;

        try {
            // ┌─────────────────────────────────────────────────┐
            // │ 🚧 开发阶段：使用 Mock 模拟 api().user.login() │
            // │ 正式接入时替换为：│
            // │ const profile = await api().user.login(credentials); │
            // └─────────────────────────────────────────────────┘
            const profile = await new Promise<UserProfile>((resolve, reject) => {
                setTimeout(() => {
                    // 模拟：username为 "error" 时触发错误分支
                    if (credentials.username.toLowerCase() === 'error') {
                        reject(new Error('认证失败：用户名或密码不正确'));
                        return;
                    }

                    //── Mock 假数据 ──
                    resolve({
                        id: 10001,
                        username: credentials.username,
                        email: `${credentials.username}@acme.corp`,
                        avatar: `https://api.dicebear.com/9.x/thumbs/svg?seed=${credentials.username}`,
                        role: 'admin',
                        createdAt: new Date(),
                    });
                }, 500); // 模拟 500ms 网络延迟
            });

            //成功：赋值用户状态
            this.#user = profile;
            this.#lastUpdated = new Date();

            // 登录成功后广播事件，供其他 Store 响应
            //   evtbus.emit('user:login:success', profile);
        } catch (e: unknown) {
            const message = e instanceof Error ? e.message : String(e);
            this.#error = message;

            // 登录失败也广播，供 Toast/Notification 组件消费
            //   evtbus.emit('user:login:failed', message);
        } finally {
            this.#isLoading = false;
        }
    }

    // ━━━ 公开Action：清除错误 ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    clearError(): void {
        this.#error = null;
    }

    // // ━━━ 私有：重置全部状态 ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // #reset(): void {
    //     this.#user = null;
    //     this.#isLoading = false;
    //     this.#error = null;
    //     this.#lastUpdated = null;
    // }

    // // ━━━ 私有：局部更新用户资料 ━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // #patchUser(patch: Partial<UserProfile>): void {
    //     if (!this.#user) {
    //         console.warn('[UserStore] 尝试更新用户资料但当前未登录');
    //         return;
    //     }
    //     this.#user = { ...this.#user, ...patch };
    //     this.#lastUpdated = new Date();
    //     console.info('[UserStore] 用户资料已局部更新', patch);
    // }
}

// ━━━ 单例导出 ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
const KEY = Symbol.for('unigen.renderer.userStore');
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const userStore: UserStore = ((globalThis as any)[KEY] ??= new UserStore());