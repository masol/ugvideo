import { throwNotfound } from '$libs/utils/err.js';
import type { Provider } from '$types/index.js';
import type { SpeechModelV4 } from '@ai-sdk/provider';
import { createProvider } from '../provider.js';

/**
 * 语音合成（TTS）模型工厂。
 * 直接使用 Vercel AI SDK 的 SpeechModelV4 接口。
 * 
 * 对于未被 SDK 识别的模型，可以通过本目录下的适配器扩展，
 * 注册机制与 image 类似（见 registry.ts 示例）。
 */
export function createSpeechModel(
    provider: Provider,
    modelId: string,
): SpeechModelV4 {
    // TODO: 接入适配器检测，若命中则返回自定义实现
    const pvInst = createProvider(provider);
    const model = pvInst.speechModel?.(modelId);
    if (!model) {
        throwNotfound(`${provider.id}不支持语音合成模型。`)
    }
    return model
}