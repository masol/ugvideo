import { throwNotfound } from '$libs/utils/err.js';
import type { Provider } from '$types/index.js';
import type { TranscriptionModelV4 } from '@ai-sdk/provider';
import { createProvider } from '../provider.js';

/**
 * 语音识别（ASR）模型工厂。
 * 直接使用 Vercel AI SDK 的 TranscriptionModelV4 接口。
 */
export function createTranscriptionModel(
    provider: Provider,
    modelId: string,
): TranscriptionModelV4 {
    // TODO: 接入适配器检测，若命中则返回自定义实现
    const pvInst = createProvider(provider);
    const model = pvInst.transcriptionModel?.(modelId);
    if (!model) {
        throwNotfound(`${provider.id}不支持语音识别模型。`)
    }
    return model;
}