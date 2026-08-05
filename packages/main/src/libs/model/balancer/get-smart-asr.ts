import { throwNotfound } from '$libs/utils/err.js';
import { IRunnerContext } from '$types/blueprint/context.js';
import { ModelTags } from '$types/shared/model.js';
import type {
    TranscriptionModelV4,
    TranscriptionModelV4CallOptions,
    TranscriptionModelV4Result,
} from '@ai-sdk/provider';
import Logger from 'electron-log/main.js';
import { createTranscriptionModel } from '../factory/transcription/index.js';
import { selectCandidates, SortStrategy, type Candidate } from './candidate.js';
import { getLimiter, syncAndGetProviders } from './pool-registry.js';

export interface GetSmartASROptions {
    requiredAbilities?: ModelTags[];
    preferVersion?: ModelTags;
    minScore?: number;
    modelPattern?: RegExp;
    exact?: { providerId: string; modelId: string };
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
    options: TranscriptionModelV4CallOptions,
    ctx?: IRunnerContext,
): TranscriptionModelV4CallOptions {
    if (!ctx?.signal) return options;
    const existing = options.abortSignal;
    const merged =
        existing && typeof AbortSignal.any === 'function'
            ? AbortSignal.any([existing, ctx.signal])
            : ctx.signal;
    return { ...options, abortSignal: merged };
}

function buildASRProxy(
    candidates: Candidate[],
    ctx?: IRunnerContext,
): TranscriptionModelV4 {
    const models = candidates.map((c) => ({
        c,
        model: createTranscriptionModel(c.provider, c.model.id),
    }));

    const first = models[0].model;

    const proxy: TranscriptionModelV4 = {
        specificationVersion: first.specificationVersion,
        provider: first.provider,
        modelId: first.modelId,

        async doGenerate(
            options: TranscriptionModelV4CallOptions,
        ): Promise<TranscriptionModelV4Result> {
            let lastErr: unknown;
            const merged = mergeSignal(options, ctx);

            for (let i = 0; i < models.length; i++) {
                if (ctx?.isAborted) {
                    throw new DOMException('Aborted by context', 'AbortError');
                }
                const { c, model } = models[i];
                try {
                    return await c.limiter.run(() => model.doGenerate(merged));
                } catch (e) {
                    lastErr = e;
                    if (isAbortError(e) || ctx?.isAborted) {
                        (ctx?.warn ?? Logger.warn)(
                            `[asr] 已取消,终止 fallback (${c.provider.id}::${c.model.id})`,
                        );
                        throw e;
                    }
                    (ctx?.warn ?? Logger.warn)(
                        `🚨 [asr] 候选 [${c.provider.id}::${c.model.id}] 失败,尝试下一个...`,
                    );
                    if (!isRetryable(e)) throw e;
                }
            }
            throw lastErr;
        },
    };

    return proxy;
}

export function getSmartASR(
    opts: GetSmartASROptions = {},
    ctx?: IRunnerContext,
): TranscriptionModelV4 {
    if (opts.exact) {
        const { providerId, modelId } = opts.exact;
        const providers = syncAndGetProviders();
        const pv = providers.find((p) => p.id === providerId);
        if (!pv) {
            throwNotfound(
                `[getSmartASR] 精确指定失败:找不到 provider "${providerId}"`,
            );
        }
        const model = pv.models.find((m) => m.id === modelId);
        if (!model) {
            throwNotfound(
                `[getSmartASR] 精确指定失败:provider "${providerId}" 下无模型 "${modelId}"`,
            );
        }
        const limiter = getLimiter(providerId);
        if (!limiter) {
            throwNotfound(
                `[getSmartASR] 精确指定失败:provider "${providerId}" 无并发通道`,
            );
        }
        return buildASRProxy([{ provider: pv, model, limiter }], ctx);
    }

    let candidates = selectCandidates({
        category: ModelTags.AudioUnderstanding, // ASR 属于音频理解
        requiredAbilities: opts.requiredAbilities,
        preferVersion: opts.preferVersion,
        minScore: opts.minScore,
        sort: opts.sort,
    });

    if (opts.modelPattern) {
        candidates = candidates.filter((c) => opts.modelPattern!.test(c.model.id));
    }

    if (candidates.length === 0) {
        throwNotfound(
            `[getSmartASR] 无满足要求的 ASR 模型 abilities=[${(
                opts.requiredAbilities ?? []
            ).join(', ')}] preferVersion=${opts.preferVersion ?? '任意'} minScore=${opts.minScore ?? 0
            }${opts.modelPattern ? ` pattern=${opts.modelPattern}` : ''}`,
        );
    }

    return buildASRProxy(candidates, ctx);
}