import type { Provider } from '$types/index.js';
import type { ImageModelV4CallOptions } from '@ai-sdk/provider';

export type ExtendedImageOptions = ImageModelV4CallOptions & {
    providerOptions?: Record<string, unknown>;
};

export type ImageOptsTransformer = (
    options: ExtendedImageOptions,
    provider: Provider,
    modelId: string,
) => ImageModelV4CallOptions;