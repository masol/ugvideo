import type { Provider } from '$types/index.js';
import type { LanguageModelV4 } from '@ai-sdk/provider';
import { createProvider } from '../provider.js';

/**
 * 机器翻译（MT）模型工厂。
 * 当前采用通用 LLM 接口实现（LanguageModelV4），
 * 未来可替换为专用翻译模型或适配器。
 */
export function createMTModel(
    provider: Provider,
    modelId: string,
): LanguageModelV4 {
    // TODO: 接入适配器检测，若命中则返回自定义实现
    const pvInst = createProvider(provider);
    return pvInst.languageModel(modelId);
}