import { throwNotfound } from '$libs/utils/err.js';
import { IRunnerContext } from '$types/blueprint/context.js';
import { ModelTags } from '$types/shared/model.js';
import {
    ImageModelV4,
    ImageModelV4CallOptions,
    ImageModelV4Result,
} from '@ai-sdk/provider';
import Logger from 'electron-log/main.js';
import { createImageModel } from '../index.js';
import { getImageOptsTransformer } from '../opts-transform/registry.js';
import { selectCandidates, SortStrategy, type Candidate } from './candidate.js';
import { getLimiter, syncAndGetProviders } from './pool-registry.js';

export interface GetSmartImageOptions {
    requiredAbilities?: ModelTags[];
    preferVersion?: ModelTags;
    minScore?: number;
    modelPattern?: RegExp;
    exact?: { providerId: string; modelId: string };
    /** 候选排序策略,默认 VersionDesc */
    sort?: SortStrategy;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function isRetryable(error: any): boolean {
    const status = error?.statusCode ?? error?.status;
    return status === 429 || status === 500 || status === 502 || status === 503;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function isAbortError(error: any): boolean {
    return (
        error?.name === 'AbortError' ||
        error?.name === 'TimeoutError' ||
        error?.code === 'ABORT_ERR'
    );
}

function mergeSignal(
    options: ImageModelV4CallOptions,
    ctx?: IRunnerContext,
): ImageModelV4CallOptions {
    if (!ctx?.signal) return options;
    const existing = options.abortSignal;
    const merged =
        existing && typeof AbortSignal.any === 'function'
            ? AbortSignal.any([existing, ctx.signal])
            : ctx.signal;
    return { ...options, abortSignal: merged };
}

function buildImageProxy(
    candidates: Candidate[],
    ctx?: IRunnerContext,
): ImageModelV4 {
    const models = candidates.map((c) => ({
        c,
        model: createImageModel(c.provider, c.model.id),
        transformer: getImageOptsTransformer(c.provider)
    }));

    const first = models[0].model;

    const proxy: ImageModelV4 = {
        specificationVersion: first.specificationVersion,
        provider: first.provider,
        modelId: first.modelId,
        maxImagesPerCall: first.maxImagesPerCall,

        async doGenerate(
            options: ImageModelV4CallOptions,
        ): Promise<ImageModelV4Result> {
            let lastErr: unknown;
            const merged = mergeSignal(options, ctx);

            for (let i = 0; i < models.length; i++) {
                if (ctx?.isAborted) {
                    throw new DOMException('Aborted by context', 'AbortError');
                }
                const { c, model, transformer } = models[i];
                try {
                    const transformed = transformer ? transformer(merged, c.provider, c.model.id) : merged;
                    return await c.limiter.run(() => model.doGenerate(transformed));
                } catch (e) {
                    lastErr = e;
                    if (isAbortError(e) || ctx?.isAborted) {
                        (ctx?.warn ?? Logger.warn)(
                            `[image] 已取消,终止 fallback (${c.provider.id}::${c.model.id})`,
                        );
                        throw e;
                    }
                    (ctx?.warn ?? Logger.warn)(
                        `🚨 [image] 候选 [${c.provider.id}::${c.model.id}] 失败,尝试下一个...`,
                    );
                    if (!isRetryable(e)) throw e;
                }
            }
            throw lastErr;
        },
    };

    return proxy;
}

export function getSmartImage(
    opts: GetSmartImageOptions = {},
    ctx?: IRunnerContext,
): ImageModelV4 {
    // ========== 分支 1:精确指定 ==========
    if (opts.exact) {
        const { providerId, modelId } = opts.exact;
        const providers = syncAndGetProviders();
        const pv = providers.find((p) => p.id === providerId);
        if (!pv) {
            throwNotfound(
                `[getSmartImage] 精确指定失败:找不到 provider "${providerId}"`,
            );
        }
        const model = pv.models.find((m) => m.id === modelId);
        if (!model) {
            throwNotfound(
                `[getSmartImage] 精确指定失败:provider "${providerId}" 下无模型 "${modelId}"`,
            );
        }
        const limiter = getLimiter(providerId);
        if (!limiter) {
            throwNotfound(
                `[getSmartImage] 精确指定失败:provider "${providerId}" 无并发通道`,
            );
        }
        return buildImageProxy([{ provider: pv, model, limiter }], ctx);
    }

    // ========== 分支 2:能力筛选 + 正则 + fallback ==========
    let candidates = selectCandidates({
        category: ModelTags.ImageGeneration,
        requiredAbilities: opts.requiredAbilities,
        preferVersion: opts.preferVersion,
        minScore: opts.minScore,
        sort: opts.sort,
    });

    if (opts.modelPattern) {
        const re = opts.modelPattern;
        candidates = candidates.filter((c) => re.test(c.model.id));
    }

    if (candidates.length === 0) {
        throwNotfound(
            `[getSmartImage] 无满足要求的 image 模型 abilities=[${(
                opts.requiredAbilities ?? []
            ).join(', ')}] preferVersion=${opts.preferVersion ?? '任意'} minScore=${opts.minScore ?? 0
            }${opts.modelPattern ? ` pattern=${opts.modelPattern}` : ''}`,
        );
    }

    return buildImageProxy(candidates, ctx);
}