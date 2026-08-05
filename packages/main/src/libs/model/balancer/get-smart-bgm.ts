import { throwNotfound } from '$libs/utils/err.js';
import { IRunnerContext } from '$types/blueprint/context.js';
import { ModelTags } from '$types/shared/model.js';
import Logger from 'electron-log/main.js';
import { createBGMModel, type BGMModel } from '../factory/bgm/index.js';
import { selectCandidates, SortStrategy, type Candidate } from './candidate.js';
import { getLimiter, syncAndGetProviders } from './pool-registry.js';

export interface GetSmartBGMOptions {
    requiredAbilities?: ModelTags[];
    preferVersion?: ModelTags;
    minScore?: number;
    modelPattern?: RegExp;
    exact?: { providerId: string; modelId: string };
    sort?: SortStrategy;
}

function buildBGMProxy(
    candidates: Candidate[],
    ctx?: IRunnerContext,
): BGMModel {
    const models = candidates.map((c) => ({
        c,
        model: createBGMModel(c.provider, c.model.id),
    }));

    const first = models[0].model;

    const proxy: BGMModel = {
        specificationVersion: first.specificationVersion,
        provider: first.provider,
        modelId: first.modelId,

        async doGenerate(options) {
            let lastErr: unknown;
            for (let i = 0; i < models.length; i++) {
                if (ctx?.isAborted) throw new DOMException('Aborted by context', 'AbortError');
                const { c, model } = models[i];
                try {
                    return await c.limiter.run(() => model.doGenerate(options));
                } catch (e) {
                    lastErr = e;
                    if (ctx?.isAborted) {
                        (ctx?.warn ?? Logger.warn)(
                            `[bgm] 已取消,终止 fallback (${c.provider.id}::${c.model.id})`,
                        );
                        throw e;
                    }
                    (ctx?.warn ?? Logger.warn)(
                        `🚨 [bgm] 候选 [${c.provider.id}::${c.model.id}] 失败,尝试下一个...`,
                    );
                }
            }
            throw lastErr;
        },
    };

    return proxy;
}

export function getSmartBGM(
    opts: GetSmartBGMOptions = {},
    ctx?: IRunnerContext,
): BGMModel {
    if (opts.exact) {
        const { providerId, modelId } = opts.exact;
        const providers = syncAndGetProviders();
        const pv = providers.find((p) => p.id === providerId);
        if (!pv) throwNotfound(`[getSmartBGM] 精确指定失败:找不到 provider "${providerId}"`);
        const model = pv.models.find((m) => m.id === modelId);
        if (!model) throwNotfound(`[getSmartBGM] 精确指定失败:provider "${providerId}" 下无模型 "${modelId}"`);
        const limiter = getLimiter(providerId);
        if (!limiter) throwNotfound(`[getSmartBGM] 精确指定失败:provider "${providerId}" 无并发通道`);
        return buildBGMProxy([{ provider: pv, model, limiter }], ctx);
    }

    let candidates = selectCandidates({
        category: ModelTags.BGM,
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
            `[getSmartBGM] 无满足要求的 BGM 模型 abilities=[${(
                opts.requiredAbilities ?? []
            ).join(', ')}] preferVersion=${opts.preferVersion ?? '任意'} minScore=${opts.minScore ?? 0
            }${opts.modelPattern ? ` pattern=${opts.modelPattern}` : ''}`,
        );
    }

    return buildBGMProxy(candidates, ctx);
}