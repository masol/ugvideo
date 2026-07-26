/* eslint-disable @typescript-eslint/no-explicit-any */
import type { PrjTimeStore } from "$types/prjstore.js";
import dayjs, { Dayjs } from "dayjs";
import { isPlainObject } from "radashi";


export function isPrjtimeStore<T>(value: unknown): value is PrjTimeStore<T> {
    return isPlainObject(value) && "value" in value && "updatedAt" in value;
}

/**
 * 工具函数：直接获取值（解包顶层 PrjTimeStore）
 *
 * 历史上曾支持对数组成员做递归解包（成员形如 { item: PrjTimeStore }），
 * 但当前 codebase 中该嵌套结构已不存在——所有KV 值均以裸值存取。
 * 因此只做顶层解包，不再遍历数组成员。
 */
export function unwrapPrjTime<T>(value: T | PrjTimeStore<T>): T {
    if (!isPrjtimeStore(value)) {
        return value;
    }
    return value.value;
}

/**
 * PrjTimeStore 视图，专注于时间判断和递归访问
 * 只处理单个 PrjTimeStore，保持单一数据源
 */
export class PrjTimeView<T = any> {
    private readonly raw: PrjTimeStore<T>;

    private constructor(value: PrjTimeStore<T>) {
        this.raw = value;
    }

    /**
     * 创建视图，如果不是 PrjTimeStore 则返回 null
     */
    static create<T>(value: unknown): PrjTimeView<T> | null {
        if (!isPrjtimeStore<T>(value)) {
            return null;
        }
        return new PrjTimeView(value);
    }

    /** 获取外层的更新时间 */
    get updatedAt(): Dayjs | null {
        return this.raw.updatedAt ? dayjs(this.raw.updatedAt) : null;
    }

    /** 获取原始值（已解包） */
    get value(): T {
        return this.raw.value;
    }

    /** 是否是数组 */
    get isArray(): boolean {
        return Array.isArray(this.raw.value);
    }

    /** 数组长度（如果是数组） */
    get length(): number {
        return Array.isArray(this.raw.value) ? this.raw.value.length : 0;
    }

    /**
     * 获取时间（最新或最早）。
     *
     * 当前数据模型中每个 KV 条目只有顶层一个 updatedAt，
     * bLatest 参数保留以维持签名一致性，实际上只有一个值可返回。
     */
    private getPrjTime(_bLatest: boolean): Dayjs | null {
        return this.raw.updatedAt ? dayjs(this.raw.updatedAt) : null;
    }

    /**
     * 获取最新时间
     */
    getLatestTime(): Dayjs | null {
        return this.getPrjTime(true);
    }

    /**
     * 获取最早时间
     */
    getEarliestTime(): Dayjs | null {
        return this.getPrjTime(false);
    }

    /**
     * 获取所有时间戳
     */
    getAllTimes(): Dayjs[] {
        const times: Dayjs[] = [];
        if (this.raw.updatedAt) {
            times.push(dayjs(this.raw.updatedAt));
        }
        return times;
    }

    /**
     * 获取剥离后的值（非侵入式）
     */
    stripValue(): T {
        return unwrapPrjTime(this.raw);
    }

    //===== 数组访问方法 =====

    /** 获取第 n 个元素（如果是数组） */
    at(index: number): T extends Array<infer U> ? U | undefined : undefined {
        if (!Array.isArray(this.raw.value)) {
            return undefined as any;
        }
        return this.raw.value.at(index) as any;
    }

    /** 获取指定索引的元素（如果是数组） */
    get(index: number): T extends Array<infer U> ? U | undefined : undefined {
        if (!Array.isArray(this.raw.value)) {
            return undefined as any;
        }
        return this.raw.value[index] as any;
    }

    /**
     * 获取第 n 个元素的更新时间。
     * 当前数据模型中数组成员不携带独立时效，统一返回 store 级updatedAt。
     */
    getItemUpdatedAt(index: number): Dayjs | null {
        if (!Array.isArray(this.raw.value)) {
            return null;
        }
        const item = this.raw.value[index];
        if (item == null) {
            return null;
        }
        return this.updatedAt;
    }
}

/**
 * 工具函数：创建视图
 */
export function viewPrjTime<T>(value: unknown): PrjTimeView<T> | null {
    return PrjTimeView.create<T>(value);
}


/**
 * 工具函数：从单个 PrjTimeStore 获取时间（快捷函数）
 * 获取最新或最早时间
 */
export function getPrjTime<T>(
    value: PrjTimeStore<T> | null,
    bLatest: boolean
): Dayjs | null {
    if (!value) return null;

    const view = PrjTimeView.create(value);
    if (!view) return null;

    return bLatest ? view.getLatestTime() : view.getEarliestTime();
}

/**
 * 工具函数：处理数组的情况
 * 获取数组中所有元素的最新/最早时间
 */
export function getPrjTimeFromArray<T>(
    values: Array<PrjTimeStore<T> | null> | null,
    bLatest: boolean
): Dayjs | null {
    if (!values || values.length === 0) return null;

    let targetTime = bLatest ? dayjs(0) : dayjs().add(10, 'year');
    let bChanged = false;

    values.forEach(value => {
        if (!value) return;

        const view = PrjTimeView.create(value);
        if (!view) return;

        const time = bLatest ? view.getLatestTime() : view.getEarliestTime();

        if (time) {
            const shouldUpdate = bLatest ? time.isAfter(targetTime) : time.isBefore(targetTime);
            if (shouldUpdate) {
                targetTime = time;
                bChanged = true;
            }
        }
    });

    return bChanged ? targetTime : null;
}

/**
 * 工具函数：剥离数组中所有元素的时间信息（非侵入式）
 */
export function stripPrjTimeArray<T>(
    values: Array<PrjTimeStore<T> | null> | null
): Array<T | null> {
    if (!values) {
        return [];
    }

    return values.map(v => v ? unwrapPrjTime(v) : null);
}