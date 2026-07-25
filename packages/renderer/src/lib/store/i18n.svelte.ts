import { m } from '$lib/paraglide/messages.js';
import {
    setLocale as internalSetLocale,
    locales,
    type Locale
} from '$lib/paraglide/runtime.js';
import dayjs from 'dayjs';
import relativeTime from 'dayjs/plugin/relativeTime';

// 预加载所有需要的 dayjs 语言包（只注册，不切换）
import evtbus from '$lib/utils/evtbus';
import 'dayjs/locale/en';
import 'dayjs/locale/zh-cn';
import 'dayjs/locale/zh-tw';
import { configStore } from './config.svelte';
// import 'dayjs/locale/es';
// import 'dayjs/locale/ko';
// import 'dayjs/locale/ru';
// import 'dayjs/locale/ja';

dayjs.extend(relativeTime);
/* ---------- 类型与常量 ---------- */

type MessageKey = keyof typeof m;
type MessageParams<K extends MessageKey> = (typeof m)[K] extends (...args: infer P) => string
    ? P
    : [];

// dayjs locale 映射（处理可能的命名差异）
const DAYJS_LOCALE_MAP: Record<string, string> = {
    'zh-cn': 'zh-cn',
    'zh-tw': 'zh-tw',
    en: 'en'
    // 'es': 'es',
    // 'ko': 'ko',
    // 'ru': 'ru',
    // 'ja': 'ja',
};

/**
 * 设置 Day.js 语言
 */
function setDayjsLocale(locale: string): void {
    const dayjsLocale = DAYJS_LOCALE_MAP[locale.toLowerCase()] || 'zh-cn';
    dayjs.locale(dayjsLocale);
    // console.log('dayjsLocale=', dayjsLocale);
}

/**
 * 创建响应式翻译
 */
// 无参数版本
export function t(key: MessageKey | string): string;

// 有参数版本
export function t<K extends MessageKey>(key: K, ...params: MessageParams<K>): string;

// 实现
export function t(key: string, ...params: unknown[]): string {
    const _ = configStore.lang;
    void _;
    const fn = m[key as MessageKey];
    if (typeof fn === 'function') {
        return Reflect.apply(fn, null, params) as string;
    }
    return key;
}

function isValidLocale(str: string): str is Locale {
    return (locales as unknown as string[]).includes(str);
}

/**
 * 把任何 BCP 47 tag 折叠成最接近的、项目里实际拥有的语言。
 */
export function nearestLocale(wanted: string): Locale | undefined {
    try {
        const loc = new Intl.Locale(wanted);
        const baseName = loc.baseName.toLowerCase();
        if (isValidLocale(baseName)) return baseName;

        const lang = loc.language;
        return locales.find((a) => new Intl.Locale(a).language === lang);
    } catch {
        return undefined;
    }
}


class I18nStore {

    async setLocale(next: string) {
        const realLang = nearestLocale(next);
        if (!realLang) {
            throw new Error(`Locale "${next}" is not available`);
        }

        // 设置 Day.js 语言
        setDayjsLocale(realLang);

        // 设置应用语言
        await internalSetLocale(realLang, { reload: false });
    }

    async init() {

        evtbus.on("lang:changed", (lang: string) => {
            // console.log('on event,set lang to', lang);
            this.setLocale(lang);
        });

        this.setLocale(configStore.lang)
    }


    /**
     * 获取已配置好语言环境的 dayjs 实例
     */
    getDayjs() {
        return dayjs;
    }

    /**
     * 创建一个已配置好语言环境的 dayjs 对象
     */
    dayjs(date?: string | number | Date | dayjs.Dayjs | null | undefined) {
        return dayjs(date);
    }
}

/* ---------- 导出单例 ---------- */
const KEY = Symbol.for('unigen.renderer.i18nStore');
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const i18nStore: I18nStore = ((globalThis as any)[KEY] ??= new I18nStore());
