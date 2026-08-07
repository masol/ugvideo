import { throwNotfound } from '$libs/utils/err.js';
import type { Provider } from '$types/index.js';
import { createAlibaba } from '@ai-sdk/alibaba';
import { createByteDance } from '@ai-sdk/bytedance';
import { createKlingAI } from '@ai-sdk/klingai';
import type {
    Experimental_VideoModelV4 as VideoModelV4,
    Experimental_VideoModelV4CallOptions as VideoModelV4CallOptions,
    Experimental_VideoModelV4Result as VideoModelV4Result,
} from '@ai-sdk/provider';

/**
 * 视频生成模型工厂。
 *
 * 如果 Vercel AI SDK 的 provider 已支持 `videoModel(modelId)`，
 * 直接调用 createProvider(provider).videoModel(modelId) 即可。
 * 对于不兼容的平台，可在本目录下新建适配器（如 alibaba-video.ts），
 * 并通过 registry 机制注册（参考 image/registry.ts）。
 *
 * 当前占位实现会抛出未实现错误，不会影响类型系统。
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const videoProviderCreators: Record<string, (config: { apiKey: string; baseURL: string }) => any> = {
    seedance: createByteDance,
    alibaba: createAlibaba,
    kling: createKlingAI,
};

export function createVideoModel(provider: Provider, modelId: string): VideoModelV4 {
    const createFn = videoProviderCreators[provider.protocol ?? ""];
    if (createFn) {
        const vp = createFn({ apiKey: provider.apiKey ?? "", baseURL: provider.baseUrl });
        const model = vp.video?.(modelId) || vp.videoModel?.(modelId);
        if (!model) {
            throwNotfound(`${provider.protocol}协议未能加载模型${modelId}`);
        }
        return model as VideoModelV4;
    }
    // 兜底
    return {
        specificationVersion: 'v4',
        provider: provider.id,
        modelId,
        maxVideosPerCall: 1,
        async doGenerate(_options: VideoModelV4CallOptions): Promise<VideoModelV4Result> {
            throw new Error(`[video] 视频生成模型尚未实现 (provider=${provider.id}, model=${modelId})`);
        },
    };
}