import type { ImageModelV4CallOptions } from '@ai-sdk/provider';
import type { ExtendedImageOptions, ImageOptsTransformer } from '../types.js';

const UNIVERSAL_KEYS = ['watermark'];

export const alibabaImageOptsTransform: ImageOptsTransformer = (options, provider): ImageModelV4CallOptions => {
    const opts = (options as ExtendedImageOptions).providerOptions ?? {};

    // 提取通用参数（仅非 undefined）
    const universal: Record<string, unknown> = {};
    for (const key of UNIVERSAL_KEYS) {
        const v = opts[key];
        if (v !== undefined) universal[key] = v;
    }
    if (Object.keys(universal).length === 0) return options as ImageModelV4CallOptions;

    // 构建除去通用 key 且无 undefined 的 providerOptions
    const rest: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(opts)) {
        if (!UNIVERSAL_KEYS.includes(k) && v !== undefined) rest[k] = v;
    }

    // 合并到 provider 专属命名空间（优先 provider.id，兼容别名）
    const nsKey = provider.id; // 例如 'alibaba'
    const nsExisting = (rest[nsKey] ?? rest['alibaba'] ?? {}) as Record<string, unknown>;

    return {
        ...options,
        providerOptions: {
            ...rest,
            [nsKey]: { ...nsExisting, ...universal },
        },
    } as ImageModelV4CallOptions;
};