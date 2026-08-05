import { throwNotfound } from '$libs/utils/err.js';
import { IRunnerContext } from '$types/blueprint/context.js';
import { ModelTags } from '$types/shared/model.js';
import { generateText } from 'ai'; // 临时使用 generateText 作为翻译出口
import Logger from 'electron-log/main.js';
import { createMTModel } from '../factory/mt/index.js';
import { selectCandidates, SortStrategy, type Candidate } from './candidate.js';
import { getLimiter, syncAndGetProviders } from './pool-registry.js';

/**
 * 机器翻译专用返回类型。
 * 当前内部使用 LLM 生成翻译文本，但对外包装为简单的翻译接口。
 */
export interface MTResult {
    translation: string;
    modelId: string;
    provider: string;
}

export interface GetSmartMTOptions {
    requiredAbilities?: ModelTags[];
    preferVersion?: ModelTags;
    minScore?: number;
    modelPattern?: RegExp;
    exact?: { providerId: string; modelId: string };
    sort?: SortStrategy;
}

function buildMTProxy(
    candidates: Candidate[],
    ctx?: IRunnerContext,
): {
    translate: (text: string, targetLang: string, sourceLang?: string) => Promise<MTResult>;
} {
    const models = candidates.map((c) => ({
        c,
        model: createMTModel(c.provider, c.model.id),
    }));

    return {
        async translate(text, targetLang, sourceLang) {
            let lastErr: unknown;
            for (const { c, model } of models) {
                if (ctx?.isAborted) throw new DOMException('Aborted by context', 'AbortError');
                try {
                    const prompt = sourceLang
                        ? `Translate the following text from ${sourceLang} to ${targetLang}:\n\n${text}`
                        : `Translate the following text to ${targetLang}:\n\n${text}`;

                    const result = await c.limiter.run(() =>
                        generateText({
                            model,
                            prompt,
                            abortSignal: ctx?.signal,
                        })
                    );
                    return {
                        translation: result.text,
                        modelId: c.model.id,
                        provider: c.provider.id,
                    };
                } catch (e) {
                    lastErr = e;
                    if (ctx?.isAborted) {
                        (ctx?.warn ?? Logger.warn)(
                            `[mt] 已取消,终止 fallback (${c.provider.id}::${c.model.id})`,
                        );
                        throw e;
                    }
                    (ctx?.warn ?? Logger.warn)(
                        `🚨 [mt] 候选 [${c.provider.id}::${c.model.id}] 失败,尝试下一个...`,
                    );
                }
            }
            throw lastErr;
        },
    };
}

export function getSmartMT(
    opts: GetSmartMTOptions = {},
    ctx?: IRunnerContext,
) {
    if (opts.exact) {
        const { providerId, modelId } = opts.exact;
        const providers = syncAndGetProviders();
        const pv = providers.find((p) => p.id === providerId);
        if (!pv) throwNotfound(`[getSmartMT] 精确指定失败:找不到 provider "${providerId}"`);
        const model = pv.models.find((m) => m.id === modelId);
        if (!model) throwNotfound(`[getSmartMT] 精确指定失败:provider "${providerId}" 下无模型 "${modelId}"`);
        const limiter = getLimiter(providerId);
        if (!limiter) throwNotfound(`[getSmartMT] 精确指定失败:provider "${providerId}" 无并发通道`);
        return buildMTProxy([{ provider: pv, model, limiter }], ctx);
    }

    let candidates = selectCandidates({
        category: ModelTags.MT,
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
            `[getSmartMT] 无满足要求的 MT 模型 abilities=[${(
                opts.requiredAbilities ?? []
            ).join(', ')}] preferVersion=${opts.preferVersion ?? '任意'} minScore=${opts.minScore ?? 0
            }${opts.modelPattern ? ` pattern=${opts.modelPattern}` : ''}`,
        );
    }

    return buildMTProxy(candidates, ctx);
}