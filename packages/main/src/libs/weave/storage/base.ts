/**
 * weaver · Storage 基类
 *
 * 极薄一层：namespace 前缀 + 转调 prjdb。
 */

import { PrjDB } from "$libs/project/controllers/drizzle/index.js";

export abstract class BaseStorage {
    protected abstract NS: string;

    constructor(protected readonly prjdb: PrjDB) { }

    protected k(suffix: string): string {
        return `${this.NS}${suffix}`;
    }

    /**
     * 唯一允许带 key 出 storage 的方法，供 checkExpiry 门控使用。
     * 返回 NS 下的完整 key。
     */
    latestKey(suffix: string): string {
        return this.k(suffix);
    }

    protected set<T>(suffix: string, value: T): void {
        this.prjdb.set(this.k(suffix), value);
    }

    protected get<T>(suffix: string): T | null {
        return this.prjdb.get<T>(this.k(suffix));
    }

    protected has(suffix: string): boolean {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const prjdbAny = this.prjdb as any;
        if (typeof prjdbAny.has === "function") return prjdbAny.has(this.k(suffix));
        return this.get(suffix) != null;
    }
}