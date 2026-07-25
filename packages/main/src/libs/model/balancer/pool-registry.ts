import { configService } from '$libs/store/index.js';
import type { Provider } from '$types/index.js';
import { ProviderLimiter } from './provider-pool.js';

const KEY = Symbol.for('unigen.singleton.providerLimiters');
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const limiters: Map<string, ProviderLimiter> = (globalThis as any)[KEY] ??= new Map<string, ProviderLimiter>();


const DEFAULT_MAX_CONN = 10;

/**
 * 根据当前 config 同步 limiter 缓存:
 * 新增 -> 建;废弃/disabled -> 删;maxConn 变化 -> 更新并发。
 * 返回当前生效的 provider 列表(已过滤 disabled)。
 */
export function syncAndGetProviders(): Provider[] {
    const providers = configService().get('models') ?? [];
    const active = new Set<string>();
    const result: Provider[] = [];

    for (const pv of providers) {
        if (pv.disabled) continue;
        active.add(pv.id);
        result.push(pv);

        const maxConn = pv.maxConn ?? DEFAULT_MAX_CONN;
        const existing = limiters.get(pv.id);
        if (!existing) {
            limiters.set(pv.id, new ProviderLimiter(maxConn));
        } else if (existing.concurrency !== maxConn) {
            existing.setConcurrency(maxConn);
        }
    }

    // 清理废弃 provider
    for (const id of [...limiters.keys()]) {
        if (!active.has(id)) limiters.delete(id);
    }

    return result;
}

export function getLimiter(providerId: string): ProviderLimiter | undefined {
    return limiters.get(providerId);
}