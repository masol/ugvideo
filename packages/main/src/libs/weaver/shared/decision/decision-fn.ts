/**
 * weaver · 决策函数抽象
 *
 * 每个决策域（parse / split / identify-concepts / ...）实现一个 DecisionFn。
 * 决策流程：特征提取 → KB 检索 → 未命中 LLM 兜底 → 入库。
 */

import type { DecisionDomain, DecisionEntry, DecisionRef } from '../types.js';
import type { WeaveContext } from '../weave-context.js';

export interface DecisionFn<F, D> {
    /** 决策域标识 */
    readonly domain: DecisionDomain;
    /** 特征提取（确定性，无 LLM） */
    extractFeatures(input: unknown): F;
    /** 特征 → 检索文本 */
    featureText(features: F): string;
    /** LLM 兜底生成决策（仅未命中时调用） */
    llmFallback(features: F, ctx: WeaveContext): Promise<D>;
    /** 校验决策合法性（入库前） */
    validate(decision: D, features: F): boolean;
}

// ════════════════════════════════════════════════════════════════════
// decide() —— 统一决策流程
// ════════════════════════════════════════════════════════════════════

export interface DecideOptions {
    /** KB 命中阈值（score ≤ threshold 算命中） */
    threshold?: number;
    /** 强制的 KB 命中 id（跳过相似度计算） */
    forceHit?: string;
    /** 强制 LLM 兜底（跳过 KB） */
    forceFallback?: boolean;
}

export interface DecideResult<D> {
    decision: D;
    ref: DecisionRef;
}

export async function decide<F, D>(
    fn: DecisionFn<F, D>,
    input: unknown,
    boundNodeId: string,
    ctx: WeaveContext,
    opts: DecideOptions = {},
): Promise<DecideResult<D>> {
    const threshold = opts.threshold ?? 0.3;

    // 1. 特征提取
    const features = fn.extractFeatures(input);
    const featureStr = fn.featureText(features);

    // 2. KB 检索
    if (!opts.forceFallback) {
        const candidates = ctx.decisionKB.search(fn.domain, featureStr, 5);
        for (const cand of candidates) {
            const score = computeScore(featureStr, cand.featureText);
            if (score <= threshold) {
                return {
                    decision: cand.decision as D,
                    ref: {
                        domain: fn.domain,
                        entryId: cand.id,
                        score,
                        source: 'kb',
                        authority: cand.authority,
                        version: cand.version,
                    },
                };
            }
        }
    }

    // 3. LLM 兜底
    const decision = await fn.llmFallback(features, ctx);
    if (!fn.validate(decision, features)) {
        throw new Error(`[decide] 决策验证失败：domain=${fn.domain}`);
    }

    // 4. 入库
    const entry: DecisionEntry = {
        id: crypto.randomUUID(),
        domain: fn.domain,
        featureText: featureStr,
        decision: decision as unknown,
        authority: 'llm',
        version: 1,
        boundNodes: [boundNodeId],
        supersededBy: null,
        createdAt: Date.now(),
        updatedAt: Date.now(),
    };
    ctx.decisionKB.insert(entry);

    return {
        decision,
        ref: {
            domain: fn.domain,
            entryId: entry.id,
            score: 1.0,
            source: 'llm-fallback',
            authority: 'llm',
            version: 1,
        },
    };
}

/** 计算两个文本的相似度（0-1，越小越相似） */
function computeScore(a: string, b: string): number {
    const aLower = a.toLowerCase();
    const bLower = b.toLowerCase();
    if (aLower === bLower) return 0;
    const aWords = new Set(aLower.split(/\s+/));
    const bWords = new Set(bLower.split(/\s+/));
    let inter = 0;
    for (const w of aWords) if (bWords.has(w)) inter++;
    const union = aWords.size + bWords.size - inter;
    return union > 0 ? 1 - inter / union : 1;
}