import { throwNotfound } from '$libs/utils/err.js';
import { IRunnerContext } from '$types/blueprint/context.js';
import { ModelTags } from '$types/shared/model.js';
import {
    LanguageModelV4,
    LanguageModelV4CallOptions,
    LanguageModelV4Middleware,
} from '@ai-sdk/provider';
import { wrapLanguageModel } from 'ai';
import Logger from 'electron-log/main.js';
import { getErrorMessage } from 'radashi';
import { createModel } from '../index.js';
import { selectCandidates, SortStrategy, type Candidate } from './candidate.js';
import { getLimiter, syncAndGetProviders } from './pool-registry.js';
import { DEFAULT_HOLD_TIMEOUT_MS } from './provider-pool.js';

export interface GetSmartModelOptions {
    requiredAbilities?: ModelTags[];
    preferVersion?: ModelTags;
    minScore?: number;

    /** 用正则匹配 modelId(能力筛选之后再过滤) */
    modelPattern?: RegExp;

    /** 精确指定 providerId + modelId,不 fallback,只占用并发通道 */
    exact?: { providerId: string; modelId: string };

    /**
     * 流式/长任务 slot 兜底超时(毫秒)。默认 30 分钟。
     * 未来视频等长任务可调大。
     */
    streamHoldTimeoutMs?: number;
    /**
     * 候选排序策略,决定 fallback 尝试顺序(第 0 个为首选)。
     * 默认 VersionDesc:最强模型优先。
     */
    sort?: SortStrategy;
    /** 最小输入上下文窗口(Tokens),排除 inctx 不足(或未声明)的模型 */
    minInctx?: number;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function isAbortError(error: any): boolean {
    return (
        error?.name === 'AbortError' ||
        error?.name === 'TimeoutError' ||
        error?.code === 'ABORT_ERR'
    );
}

function withAbortSignal(
    params: LanguageModelV4CallOptions,
    ctx?: IRunnerContext,
): LanguageModelV4CallOptions {
    if (!ctx?.signal) return params;
    const existing = params.abortSignal;
    const merged =
        existing && typeof AbortSignal.any === 'function'
            ? AbortSignal.any([existing, ctx.signal])
            : ctx.signal;
    return { ...params, abortSignal: merged };
}

function wrapWithLimiter(
    c: Candidate,
    ctx?: IRunnerContext,
    holdTimeoutMs: number = DEFAULT_HOLD_TIMEOUT_MS,
): LanguageModelV4 {
    const base = createModel(c.provider, c.model.id);

    const mw: LanguageModelV4Middleware = {
        specificationVersion: 'v4',

        transformParams: async ({ params }) => withAbortSignal(params, ctx),

        // 非流式:Promise settle 即自动释放
        wrapGenerate: async ({ doGenerate }) => {
            if (ctx?.isAborted) {
                throw new DOMException('Aborted by context', 'AbortError');
            }
            return c.limiter.run(() => {
                Logger.debug(`[smart llm balancer]:dequeue and call with ${c.provider.id}::${c.model.id}`)
                return doGenerate()
            });
        },

        // 流式:acquire 拿 slot,流结束/出错/abort/超时 四重释放保障
        wrapStream: async ({ doStream }) => {
            if (ctx?.isAborted) {
                throw new DOMException('Aborted by context', 'AbortError');
            }

            // 1) 先拿 slot(带 30 分钟兜底超时)
            const handle = await c.limiter.acquire(holdTimeoutMs, () => {
                (ctx?.warn ?? Logger.warn)(
                    `⏰ [chat-stream] slot 持有超时(${holdTimeoutMs}ms),强制释放 (${c.provider.id}::${c.model.id})`,
                );
            });

            // 幂等释放:任何路径(flush / abort / 启动失败)都不会重复释放
            const releaseOnce = () => {
                if (!handle.released) handle.release();
            };

            // abort 兜底:signal 触发即释放
            if (ctx?.signal) {
                if (ctx.signal.aborted) {
                    releaseOnce();
                } else {
                    ctx.signal.addEventListener(
                        'abort',
                        () => releaseOnce(),
                        { once: true },
                    );
                }
            }

            let result: Awaited<ReturnType<typeof doStream>>;
            try {
                result = await doStream();
            } catch (e) {
                // 启动阶段失败:释放并抛出(让 fallback 处理)
                releaseOnce();
                throw e;
            }

            const { stream, ...rest } = result;

            const monitored = stream.pipeThrough(
                new TransformStream({
                    transform(chunk, controller) {
                        controller.enqueue(chunk);
                    },
                    flush() {
                        // 正常结束:释放 slot
                        releaseOnce();
                    },
                }),
            );

            // 兜底:如果下游消费者中途断开/抛错(例如迭代器被 break),
            // stream 会触发 error 事件;虽然 flush 在 cancel 时通常会调用,
            // 但 TransformStream 的 cancel() 路径不一定都走 flush,
            // 因此再加一层 try/catch 包住 monitored 流的消费结果不太现实,
            // 这里依赖 acquire 内部的 holdTimeoutMs 兜底,以及 abort 监听器。
            return { stream: monitored, ...rest };
        },
    };

    return wrapLanguageModel({ model: base, middleware: mw });
}

function buildFallbackModel(
    candidates: Candidate[],
    ctx?: IRunnerContext,
    holdTimeoutMs?: number,
): LanguageModelV4 {
    const wrapped = candidates.map((c) => wrapWithLimiter(c, ctx, holdTimeoutMs));
    const fallbackMw: LanguageModelV4Middleware = {
        specificationVersion: 'v4',
        wrapGenerate: async ({ doGenerate, params }) => {
            let lastErr: unknown;
            for (let i = 0; i < wrapped.length; i++) {
                if (ctx?.isAborted) {
                    throw new DOMException('Aborted by context', 'AbortError');
                }
                const c = candidates[i];
                try {
                    if (i === 0) return await doGenerate();
                    return await wrapped[i].doGenerate(params);
                } catch (e) {
                    lastErr = e;
                    if (isAbortError(e) || ctx?.isAborted) {
                        (ctx?.warn ?? Logger.warn)(
                            `[chat] 已取消,终止 fallback (${c.provider.id}::${c.model.id})`,
                        );
                        throw e;
                    }
                    const isLast = i === wrapped.length - 1;
                    const status =
                        // eslint-disable-next-line @typescript-eslint/no-explicit-any
                        (e as any)?.statusCode ?? (e as any)?.status ?? 'err';
                    if (isLast) {
                        (ctx?.error ?? Logger.error)(
                            `❌ [chat] 所有候选均失败,最后 [${c.provider.id}::${c.model.id}] (${status})`,
                        );
                        throw e;
                    }
                    (ctx?.warn ?? Logger.warn)(
                        `🚨 [chat] 候选 [${c.provider.id}::${c.model.id}] 失败 ${getErrorMessage(e)}(${status}),尝试下一个...`,
                    );
                }
            }
            throw lastErr;
        },
        wrapStream: async ({ doStream, params }) => {
            let lastErr: unknown;
            for (let i = 0; i < wrapped.length; i++) {
                if (ctx?.isAborted) {
                    throw new DOMException('Aborted by context', 'AbortError');
                }
                const c = candidates[i];
                try {
                    if (i === 0) return await doStream();
                    return await wrapped[i].doStream(params);
                } catch (e) {
                    lastErr = e;
                    if (isAbortError(e) || ctx?.isAborted) {
                        (ctx?.warn ?? Logger.warn)(
                            `[chat-stream] 已取消,终止 fallback (${c.provider.id}::${c.model.id})`,
                        );
                        throw e;
                    }
                    const isLast = i === wrapped.length - 1;
                    if (isLast) {
                        (ctx?.error ?? Logger.error)(
                            `❌ [chat-stream] 所有候选均失败,最后 [${c.provider.id}::${c.model.id}]`,
                        );
                        throw e;
                    }
                    (ctx?.warn ?? Logger.warn)(
                        `🚨 [chat-stream] 候选 [${c.provider.id}::${c.model.id}] 失败,尝试下一个...`,
                    );
                }
            }
            throw lastErr;
        },
    };
    return wrapLanguageModel({ model: wrapped[0], middleware: fallbackMw });
}

export function getSmartModel(
    opts: GetSmartModelOptions = {},
    ctx?: IRunnerContext,
): LanguageModelV4 {
    const holdTimeout = opts.streamHoldTimeoutMs ?? DEFAULT_HOLD_TIMEOUT_MS;

    // ===== 分支 1:精确指定,不 fallback,只占并发通道 =====
    if (opts.exact) {
        const { providerId, modelId } = opts.exact;
        const providers = syncAndGetProviders();
        const pv = providers.find((p) => p.id === providerId);
        if (!pv) {
            throwNotfound(
                `[getSmartModel] 精确指定失败:找不到 provider "${providerId}"(可能已禁用或移除)`,
            );
        }
        const model = pv.models.find((m) => m.id === modelId);
        if (!model) {
            throwNotfound(
                `[getSmartModel] 精确指定失败:provider "${providerId}" 下无模型 "${modelId}"`,
            );
        }
        const limiter = getLimiter(providerId);
        if (!limiter) {
            throwNotfound(
                `[getSmartModel] 精确指定失败:provider "${providerId}" 无并发通道`,
            );
        }
        return wrapWithLimiter({ provider: pv, model, limiter }, ctx, holdTimeout);
    }

    // ===== 分支 2:能力筛选 + 正则 + fallback =====
    let candidates = selectCandidates({
        category: ModelTags.TextGeneration,
        requiredAbilities: opts.requiredAbilities,
        preferVersion: opts.preferVersion,
        minScore: opts.minScore,
        sort: opts.sort,
        minInctx: opts.minInctx,
    });

    if (opts.modelPattern) {
        const re = opts.modelPattern;
        candidates = candidates.filter((c) => re.test(c.model.id));
    }

    if (candidates.length === 0) {
        throwNotfound(
            `[getSmartModel] 无满足要求的 chat 模型 abilities=[${(
                opts.requiredAbilities ?? []
            ).join(', ')}] preferVersion=${opts.preferVersion ?? '任意'} minScore=${opts.minScore ?? 0
            } minInctx=${opts.minInctx ?? '不限'}${opts.modelPattern ? ` pattern=${opts.modelPattern}` : ''
            }`,
        );
    }

    return buildFallbackModel(candidates, ctx, holdTimeout);
}