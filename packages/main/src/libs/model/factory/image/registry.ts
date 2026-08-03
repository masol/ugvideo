import type { Provider } from '$types/index.js';
import type { ImageModelV4 } from '@ai-sdk/provider';
import { alibabaImageAdapter } from './alibaba.js';

/**
 * 一个"生图兼容适配器"的注册项。
 * 用于承接那些不被 vercel ai sdk 支持(或其 imageModel 白名单拦截)的平台。
 *
 * 未来接入新的不兼容平台时,只需:
 *   1. 在本目录下新增 xxx.ts,导出一个 ImageAdapterEntry;
 *   2. 把它加入下方 ADAPTERS 数组即可。
 * 适配器模块不反向依赖本文件,避免循环依赖。
 */
export interface ImageAdapterEntry {
    /**
     * 命中判定:host 已小写。
     * 返回 true 表示由本适配器接管。
     */
    match: (host: string, provider: Provider) => boolean;
    /** 构造一个符合 ImageModelV4 契约的实现。 */
    create: (provider: Provider, modelId: string) => ImageModelV4;
}

const ADAPTERS: ImageAdapterEntry[] = [alibabaImageAdapter];

/**
 * 根据 provider.baseUrl 的 host 解析出应接管的兼容适配器。
 * 无匹配(或 baseUrl 非法/缺失)时返回 undefined,交回默认 vercel ai sdk 路径。
 */
export function resolveImageAdapter(
    provider: Provider,
): ImageAdapterEntry['create'] | undefined {
    const raw = provider.baseUrl?.trim();
    if (!raw) return undefined;

    let host: string;
    try {
        host = new URL(raw).host.toLowerCase();
    } catch {
        return undefined;
    }

    const entry = ADAPTERS.find((a) => a.match(host, provider));
    return entry?.create;
}