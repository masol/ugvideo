import type { Provider } from '$types/index.js';
import { alibabaImageOptsTransform } from './image/alibaba.js';
import type { ImageOptsTransformer } from './types.js';

const transformers: Array<{
    match: (host: string, provider: Provider) => boolean;
    transform: ImageOptsTransformer;
}> = [
        { match: (host) => host.includes('aliyun'), transform: alibabaImageOptsTransform },
    ];

export function getImageOptsTransformer(provider: Provider): ImageOptsTransformer | undefined {
    const host = provider.baseUrl ? new URL(provider.baseUrl).host.toLowerCase() : '';
    const entry = transformers.find((t) => t.match(host, provider));
    return entry?.transform;
}