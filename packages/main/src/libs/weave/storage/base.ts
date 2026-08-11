/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * weaver · Storage 基类
 *
 * 不可变 KV 语义：
 * - 内部维护 per-suffix revision 计数器（内存索引）
 * - write(): 计数器 +1 落新 key，从不覆盖
 * - read(): 直接拼最新 key 读取
 * - readMerged(): 从 rev1 读到当前计数
 * - has(): 计数器 > 0 即存在
 * - latestKey(): 暴露给 checkExpiry 的唯一 key 出口
 *
 * 之所以不用 prjdb.keys()：
 *   1. 该接口不可用
 *   2. 内存索引更高效（O(1) 查最新）
 *   3. 索引本身也是 KV，持久化层故障时可由 prjdb 重建
 */

import { PrjDB } from '$libs/project/controllers/drizzle/index.js';

export abstract class BaseStorage {
    protected abstract NS: string;

    /**
     * suffix → 当前最大 revision 号（1 = 基础 key，2 = @rev2，...）
     * 初始化时从 prjdb 扫描恢复（首次实例化时）
     */
    private revIndex: Map<string, number> = new Map();

    constructor(protected readonly prjdb: PrjDB) {
        this.bootstrap();
    }

    // ────────────────────────────────────────────────────────────────
    // 启动恢复：扫描当前 NS 下所有已知 key，构建 revision 索引
    // ────────────────────────────────────────────────────────────────

    /**
     * 扫描 prjdb 中所有 key，匹配本 NS 前缀的，提取其 revision 号。
     * 注：依赖 prjdb 提供某种遍历接口（即使没有 keys()，也可能有 values() 或 all()）。
     * 如果完全没有遍历能力，则初始化为空，仅靠当前会话内的 write 维持索引。
     */
    private bootstrap(): void {
        try {
            const allKeys = this.scanAllKeys();
            for (const fullKey of allKeys) {
                if (!fullKey.startsWith(this.NS)) continue;
                const suffix = fullKey.slice(this.NS.length);
                const revNo = this.parseRevNo(suffix);
                if (revNo === null) continue;

                const baseSuffix = this.stripRevSuffix(suffix);
                const current = this.revIndex.get(baseSuffix) ?? 0;
                if (revNo > current) {
                    this.revIndex.set(baseSuffix, revNo);
                }
            }
        } catch {
            // prjdb 不支持遍历时，bootstrap 静默失败
            // 仅依赖本次会话内的 write 维护索引
        }
    }

    /**
     * 从 prjdb 扫描所有 key。
     * 适配 prjdb 的实际接口（如果有 listAll() / keys() / scan() 等）。
     */
    private scanAllKeys(): string[] {
        const prjdbAny = this.prjdb as any;
        if (typeof prjdbAny.keys === 'function') return prjdbAny.keys();
        if (typeof prjdbAny.listAll === 'function') return prjdbAny.listAll();
        if (typeof prjdbAny.scan === 'function') return prjdbAny.scan();
        if (typeof prjdbAny.allKeys === 'function') return prjdbAny.allKeys();
        return [];
    }

    private parseRevNo(suffix: string): number | null {
        if (suffix.includes('@rev')) {
            const m = suffix.match(/@rev(\d+)$/);
            return m ? Number(m[1]) : null;
        }
        return 1;
    }

    private stripRevSuffix(suffix: string): string {
        const idx = suffix.indexOf('@rev');
        return idx >= 0 ? suffix.slice(0, idx) : suffix;
    }

    // ────────────────────────────────────────────────────────────────
    // 内部工具
    // ────────────────────────────────────────────────────────────────

    private k(suffix: string, revNo?: number): string {
        const suffixPart = revNo && revNo > 1 ? `${suffix}@rev${revNo}` : suffix;
        return `${this.NS}${suffixPart}`;
    }

    /**
     * 不可变写入：revIndex +1 落新 key，从不覆盖
     */
    protected write<T>(suffix: string, value: T): void {
        const currentRev = this.revIndex.get(suffix) ?? 0;
        const newRev = currentRev + 1;
        this.revIndex.set(suffix, newRev);
        this.prjdb.set(this.k(suffix, newRev), value);
    }

    /**
     * latest-wins 读取：直接拼最新 key
     */
    protected read<T>(suffix: string): T | null {
        const currentRev = this.revIndex.get(suffix) ?? 0;
        if (currentRev === 0) return null;
        return this.prjdb.get<T>(this.k(suffix, currentRev));
    }

    /**
     * merged 读取：从 rev1 读到当前
     */
    protected readAll<T>(suffix: string): T[] {
        const currentRev = this.revIndex.get(suffix) ?? 0;
        if (currentRev === 0) return [];
        const out: T[] = [];
        for (let r = 1; r <= currentRev; r++) {
            const v = this.prjdb.get<T>(this.k(suffix, r));
            if (v != null) out.push(v);
        }
        return out;
    }

    protected has(suffix: string): boolean {
        return (this.revIndex.get(suffix) ?? 0) > 0;
    }

    /**
     * 唯一允许把 key 信息带出 storage 的方法，供 checkExpiry 门控使用
     */
    latestKey(suffix: string): string {
        const currentRev = this.revIndex.get(suffix) ?? 0;
        const suffixPart = currentRev > 1 ? `${suffix}@rev${currentRev}` : suffix;
        return suffixPart;
    }

    /**
     * 显式供特殊场景使用：制造一次"空写"使 key 存在
     * （用于占位语义，不常见）
     */
    protected touch(suffix: string): void {
        if (!this.has(suffix)) {
            this.write(suffix, null as any);
        }
    }
}