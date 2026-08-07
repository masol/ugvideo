import { throwNotfound } from '$libs/utils/err.js';
import type { Provider } from '$types/index.js';
import { createByteDance } from '@ai-sdk/bytedance';
import { createKlingAI } from '@ai-sdk/klingai';
import type { ImageModelV4 } from '@ai-sdk/provider';
import { createProvider } from '../provider.js';
import { resolveImageAdapter } from './registry.js';



// eslint-disable-next-line @typescript-eslint/no-explicit-any
const imageProviderCreators: Record<string, (config: { apiKey: string; baseURL: string }) => any> = {
    seedance: createByteDance,
    kling: createKlingAI,
};


/**
 * provider: $llama-cpp / node-llama-cpp: 以 $ 开头的 Provider 为内建 Provider。
 *
 * 部分平台(如阿里云百炼 wan 系列)不被 vercel ai sdk 的 imageModel 白名单接受,
 * 会在发请求前抛 AI_NoSuchModelError。这里先按 baseUrl 的 host 匹配兼容适配器,
 * 命中则由适配器返回符合 ImageModelV4 契约的实现;否则回落到 SDK 默认路径。
 * 因返回值统一为 ImageModelV4,getSmartImage / fallback 逻辑无需改动。
 */
export function createImageModel(
    provider: Provider,
    modelId: string,
): ImageModelV4 {
    const adapter = resolveImageAdapter(provider);
    if (adapter) {
        return adapter(provider, modelId);
    }

    const createFn = imageProviderCreators[provider.protocol ?? ""];
    if (createFn) {
        const vp = createFn({ apiKey: provider.apiKey ?? "", baseURL: provider.baseUrl });
        const model = vp.imageModel?.(modelId) || vp.image?.(modelId);
        if (!model) {
            throwNotfound(`${provider.protocol}协议未能加载模型${modelId}`);
        }
        return model;
    }

    const pvInst = createProvider(provider);
    return pvInst.imageModel(modelId);
}