import { Model, ModelTags, Provider } from '$types/index.js';
import { getLimiter, syncAndGetProviders } from './pool-registry.js';
import { ProviderLimiter } from './provider-pool.js';
import { requiredVersionRank, versionRank } from './version.js';

export interface Candidate {
    provider: Provider;
    model: Model;
    limiter: ProviderLimiter;
}

/**
 * 排序策略:决定候选的"强弱链"顺序(fallback 依此链依次上溯)。
 * ⚠️ 空闲优先不属于此策略——它只决定"从链的哪个位置切入",
 *    绝不打乱本链的相对强弱顺序。
 */
export enum SortStrategy {
    VersionDesc = 'version-desc',
    VersionAsc = 'version-asc',
    ScoreDesc = 'score-desc',
    ScoreAsc = 'score-asc',
}

export const DEFAULT_SORT = SortStrategy.VersionDesc;

export interface SelectOptions {
    /** 目标类别标签，例如 TextGeneration、ImageGeneration、VideoGeneration 等 */
    category: ModelTags;
    requiredAbilities?: ModelTags[];
    preferVersion?: ModelTags;
    minScore?: number;
    sort?: SortStrategy;
    /**
     * 最小输入上下文窗口(Tokens)。排除 inctx 不足的模型。
     * ⚠️ 未声明 inctx 的模型也会被排除(无法保证够用,稳定优先)。
     */
    minInctx?: number;
}

const DEFAULT_SCORE = 50;

/** 按 sort 策略决定强弱链顺序。返回 <0 表示 a 更"靠前(应先选)"。 */
function compareBySort(a: Candidate, b: Candidate, sort: SortStrategy): number {
    const va = versionRank(a.model.abilities ?? []);
    const vb = versionRank(b.model.abilities ?? []);
    const sa = a.model.score ?? DEFAULT_SCORE;
    const sb = b.model.score ?? DEFAULT_SCORE;

    switch (sort) {
        case SortStrategy.VersionDesc:
            if (vb !== va) return vb - va;
            return sb - sa;
        case SortStrategy.VersionAsc:
            if (va !== vb) return va - vb;
            return sa - sb;
        case SortStrategy.ScoreDesc:
            if (sb !== sa) return sb - sa;
            return vb - va;
        case SortStrategy.ScoreAsc:
            if (sa !== sb) return sa - sb;
            return va - vb;
        default:
            return 0;
    }
}

export function selectCandidates(opts: SelectOptions): Candidate[] {
    const {
        category,
        requiredAbilities = [],
        preferVersion,
        minScore = 0,
        sort = DEFAULT_SORT,
        minInctx,
    } = opts;

    const providers = syncAndGetProviders();
    const minVer = requiredVersionRank(preferVersion);
    const candidates: Candidate[] = [];

    for (const pv of providers) {
        const limiter = getLimiter(pv.id);
        if (!limiter) continue;

        for (const model of pv.models) {
            const abilities = model.abilities ?? [];

            // 1. 类别匹配
            if (!abilities.includes(category)) continue;

            // 2. 能力标签全满足
            const hasAll = requiredAbilities.every((a) => abilities.includes(a));
            if (!hasAll) continue;

            // 3. 版本向上兼容
            if (versionRank(abilities) < minVer) continue;

            // 4. 评分门槛
            if ((model.score ?? DEFAULT_SCORE) < minScore) continue;

            // 5. 输入上下文窗口门槛:
            //    未声明 inctx 视为不满足(无法保证够用,稳定优先,排除)
            if (minInctx != null) {
                if (model.inctx == null || model.inctx < minInctx) continue;
            }

            candidates.push({ provider: pv, model, limiter });
        }
    }

    // 1) 先按 SortStrategy 排出完整强弱链
    candidates.sort((a, b) => compareBySort(a, b, sort));

    // 2) 稳定分区:有空位者整体提前,已满者整体靠后;分区内部保持强弱链顺序。
    const free: Candidate[] = [];
    const busy: Candidate[] = [];
    for (const c of candidates) {
        (c.limiter.remaining > 0 ? free : busy).push(c);
    }

    return [...free, ...busy];
}