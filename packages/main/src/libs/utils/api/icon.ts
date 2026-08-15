// icon-query.ts

import Logger from "electron-log/main.js";

export type IconKind = 'icon' | 'emoji';

/**
 * 全局图标名称查询器。
 * 内部使用 Set 保存有效名称，分为 icon 与 emoji 两类。
 * 仅支持通过 init 追加有效名称，不提供注销（删除）能力。
 * init 可重复调用（重入），每次调用都会将传入的名称追加到对应类别集合中。
 */
class IconQuery {
    private readonly iconNames = new Set<string>();
    private readonly emojiNames = new Set<string>();

    /**
     * 初始化（或追加）有效图标名称。
     * - 可多次调用，重复调用不会清空已有名称，而是追加；
     * - 自动忽略空字符串；
     * - 同一名称重复添加不会产生副作用。
     *
     * @param validNames 有效名称数组
     * @param kind 图标类别：'icon' 或 'emoji'
     */
    init(validNames: ReadonlyArray<string>, kind: IconKind): void {
        const target = kind === 'icon' ? this.iconNames : this.emojiNames;
        for (const name of validNames) {
            if (name) {
                target.add(name);
            }
        }
        Logger.debug(`[iconQuery] 初始化图标:Icon = ${this.iconNames.size}, Emoji = ${this.emojiNames.size}`,)
    }

    /**
     * 判断名称是否有效。
     * - 传入 kind 时只校验对应类别；
     * - 省略 kind 时校验全部类别。
     */
    isValid(name: string, kind?: IconKind): boolean {
        if (!name) return false;

        if (kind === 'icon') return this.iconNames.has(name);
        if (kind === 'emoji') return this.emojiNames.has(name);

        return this.iconNames.has(name) || this.emojiNames.has(name);
    }

    /** 判断是否为有效 icon 名称 */
    isValidIcon(name: string): boolean {
        return this.iconNames.has(name);
    }

    /** 判断是否为有效 emoji 名称 */
    isValidEmoji(name: string): boolean {
        return this.emojiNames.has(name);
    }

    /** 是否已初始化：任一类名称集合不为空即视为已初始化 */
    isInitialized(): boolean {
        return this.iconNames.size > 0 || this.emojiNames.size > 0;
    }
}

const KEY = Symbol.for('unigen.singleton.iconQuery');
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const iconQuery: IconQuery = ((globalThis as any)[KEY] ??= new IconQuery());