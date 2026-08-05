import type { Provider } from '$types/index.js';

/**
 * BGM 生成模型接口（临时定义）。
 * 由于 Vercel AI SDK 暂无音频生成标准，此处自定义接口，
 * 后续可替换为官方标准或保持扩展。
 */
export interface BGMModel {
    specificationVersion: 'v4';
    provider: string;
    modelId: string;
    doGenerate(options: {
        prompt: string;
        duration?: number; // 秒
        seed?: number;
        abortSignal?: AbortSignal;
    }): Promise<{ audio: Uint8Array; warnings?: unknown[] }>;
}

/**
 * BGM 生成模型工厂。
 * 目前返回一个占位实现，提示功能未开放。
 * 未来可通过适配器注册具体平台（如 Suno、Udio 等）。
 */
export function createBGMModel(
    provider: Provider,
    modelId: string,
): BGMModel {
    // TODO: 根据 provider.baseUrl 匹配适配器，返回实际实现
    return {
        specificationVersion: 'v4',
        provider: provider.id,
        modelId,
        async doGenerate() {
            throw new Error('[bgm] BGM 生成模型尚未实现，请等待后续版本。');
        },
    };
}