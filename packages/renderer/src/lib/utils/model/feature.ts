// feature.ts
import { BASE_MODELS, CTX, ModelTags, OUT, PROVIDER_RULES } from "./base_models";

export interface ModelFeatures {
    rawId: string;
    provider: string;
    baseName: string;
    versionOrDate: string;
    isSnapshot: boolean;
    abilities: ModelTags[];
    category: ModelTags | null;
    inctx?: number;
    outctx?: number;
    score?: number;
}

const T = ModelTags;
const DEFAULT_INCTX = CTX.K256;
const DEFAULT_OUT = OUT.K16;
const DEFAULT_REASON_OUT = OUT.K64;

// ============================================================================
// 约束解码黑名单
// ============================================================================
const NO_OUTLINE_MATCHERS: string[] = [
    'gpt-3.5',
    'davinci',
    'gpt-4-turbo',
    'gpt-4-0',
    'claude-3-opus',
    'claude-3-sonnet',
    'claude-3-haiku',
    'opus-mt',
    'nllb',
    'madlad',
];

// ============================================================================
// 类别优先级：决定剥离 chat 类时保留哪个类别
// ============================================================================
const CATEGORY_PRIORITY: ModelTags[] = [
    T.Embedding,
    T.Rerank,
    T.VideoGeneration,
    T.ImageGeneration,
    T.AudioUnderstanding,
    T.AudioGeneration,
    T.BGM,
    T.MT,
];

// ============================================================================
// 类别关键词正则（强信号，必须在 BASE_MODELS 匹配之前先判）
// 注意：顺序敏感——更具体的模式放前面
// ============================================================================
const CATEGORY_SIGNALS: Array<{ tag: ModelTags; re: RegExp }> = [
    {
        // 嵌入：覆盖 embedding / embeding(常见拼写错误) / embed- / -embed / embeddings
        tag: T.Embedding,
        re: /(?:^|[-_/.])embed(?:ding|ings?)?(?:[-_./-]|$)|^bge(?!-reranker)/
    },
    {
        // 重排
        tag: T.Rerank,
        re: /reranker|^rerank\b|-rerank-|rerank\./
    },
    {
        // TTS：语音合成
        tag: T.AudioGeneration,
        re: /\btts\b|\bt2s\b|text[-_]to[-_]speech|-tts-|^tts[-_]|tts\.|tts-|parler|elevenlabs|eleven-|bark\b|^speech[-_]synth|speechsynth/
    },
    {
        // ASR：语音识别
        tag: T.AudioUnderstanding,
        re: /\basr\b|\bs2t\b|speech[-_]to[-_]text|\bwhisper\b|\bstt\b|asr-|asr\.|^asr[-_]|\bvosk\b|\bdeepspeed[-_]asr/
    },
    {
        // 视频生成（T2V）：t2v / kling / runway / cogvideo / seedance / veo / sora / wan2 / hunyuan-video
        tag: T.VideoGeneration,
        re: /text[-_]to[-_]video|\bt2v\b|video[-_]generation|^video[-_]gen|\bkling\b|\brunway\b|\bpika\b|\bluma\b|cogvideo|seedance|\bveo\b|\bsora\b|wan2|wan[-_]video|hunyuan[-_]video/
    },
    {
        // 图像生成（T2I）
        tag: T.ImageGeneration,
        re: /image[-_]generation|^image[-_]gen|\bt2i\b|text[-_]to[-_]image|dall-?e|\bimagen\b|cogview|\bflux\b|diffusion|seedream|^draw|paint|wanx|qwen[-_]image|hunyuan[-_]image|sdxl|midjourney/
    },
    {
        // BGM
        tag: T.BGM,
        re: /\bbgm\b|background[-_]?music|音乐生成|jukebox|musicgen/
    },
    {
        // 机器翻译
        tag: T.MT,
        re: /(?:^|[-_/])mt(?:[-_./]|$)|translat|翻译/
    },
];

/** 在 BASE_MODELS 命中之前先检测类别关键词 */
function detectCategory(lower: string): ModelTags | null {
    for (const { tag, re } of CATEGORY_SIGNALS) {
        if (re.test(lower)) return tag;
    }
    return null;
}

// ============================================================================
// ID 关键词兜底推断（功能/能力信号）
// ============================================================================
const KEYWORD_TAGS: Array<{ re: RegExp; tag: ModelTags }> = [
    // 类别（用作兜底，与 CATEGORY_SIGNALS 保持一致）
    ...CATEGORY_SIGNALS,
    // 代码 / 数学
    { re: /(?:^|[-_/.])coder?(?:[-_./]|$)|代码/, tag: ModelTags.Code },
    { re: /(?:^|[-_/.])math(?:[-_./]|$)|数学/, tag: ModelTags.Math },
    // 能力信号（次优先）
    { re: /reason|thinking|think|-r1\b|reasoner|-o1\b|-o3\b|qwq|qvq|glm-z|magistral/, tag: ModelTags.Reasoning },
    { re: /vl\b|vision|visual|-v\d|multimodal|omni|pixtral/, tag: ModelTags.Vision },
    { re: /video(?![-_]?gen)|\bveo\b|\bsora\b|cogvideo|seedance/, tag: ModelTags.Video },
    { re: /audio|voice|speech|whisper|tts|asr|realtime/, tag: ModelTags.Audio },
    { re: /search|web|sonar|online/, tag: ModelTags.Search },
];

const VERSION_TAGS: Array<{ re: RegExp; tag: ModelTags }> = [
    { re: /ultra|\bmax\b|opus|-a\b/, tag: ModelTags.Ultra },
    { re: /\bplus\b|pro(?!mpt)|large|maverick/, tag: ModelTags.Plus },
    { re: /flash|turbo|lite|\bmini\b|haiku|air|small|fast/, tag: ModelTags.Flash },
    { re: /micro|nano|tiny|edge|端侧|0\.5b|1\.5b|1b\b|3b\b|scout/, tag: ModelTags.Micro },
];

// 所有「不可与 LLM chat 共存」的类别标签
const CATEGORY_TAGS: ModelTags[] = [
    T.Embedding, T.Rerank, T.ImageGeneration,
    T.VideoGeneration, T.AudioGeneration, T.AudioUnderstanding,
    T.BGM, T.MT,
];
// LLM 功能标签：类别模型命中时会全部剥离
const LLM_FUNCTIONAL_TAGS: ModelTags[] = [
    T.TextGeneration, T.Tool, T.Vision, T.Reasoning,
    T.Audio, T.Video, T.Search, T.Outline, T.Math, T.Code,
];
const VERSION_TIER_TAGS: ModelTags[] = [T.Ultra, T.Plus, T.Flash, T.Micro];
// AudioUnderstanding 特例：允许与 TextGeneration 共存
const AUDIO_UND_ALLOWED_TAGS: ModelTags[] = [T.TextGeneration, T.Tool, T.Vision];

// ============================================================================
// 核心解析函数
// ============================================================================
const VERSION_REGEX = /(?:\d{4}-?\d{2}-?\d{2}|v\d+(?:\.\d+)?|latest|preview|exp|instruct|chat)/i;

export function parseModel(modelId: string): ModelFeatures | null {
    if (!modelId || typeof modelId !== 'string') return null;
    const raw = modelId.trim();
    const lower = raw.toLowerCase();

    // 1. 厂商
    let provider = 'unknown';
    for (const rule of PROVIDER_RULES) {
        if (rule.keywords.some((k) => lower.includes(k))) {
            provider = rule.provider;
            break;
        }
    }

    // 2. 版本 / 日期
    const dateMatch = raw.match(/\d{4}-?\d{2}-?\d{2}/);
    const versionMatch = raw.match(VERSION_REGEX);
    const versionOrDate = versionMatch ? versionMatch[0] : 'latest';
    const isSnapshot = Boolean(dateMatch);

    // 3. baseName
    const baseName = raw
        .replace(/\d{4}-?\d{2}-?\d{2}/g, '')
        .replace(/[:@](latest|preview|exp)$/gi, '')
        .replace(/-{2,}/g, '-')
        .replace(/^-+|-+$/g, '')
        .toLowerCase();

    // 4. 【关键】先检测类别关键词 → 命中则跳过 BASE_MODELS 的 chat 匹配
    const earlyCategory = detectCategory(lower);

    let abilities: ModelTags[];
    let inctx: number | undefined;
    let outctx: number | undefined;
    let score: number | undefined;

    if (earlyCategory) {
        // 类别模型：完全跳过 BASE_MODELS 的 chat 匹配
        abilities = inferAbilitiesByKeyword(lower, earlyCategory);
        // 防御：若早期检测出类别但 inferAbilitiesByKeyword 未将其加入，强插
        if (!abilities.includes(earlyCategory)) {
            abilities.unshift(earlyCategory);
        }
        // 类别模型上下文/评分默认值
        if (abilities.includes(T.Embedding)) { inctx = CTX.K8; score = 72; }
        else if (abilities.includes(T.Rerank)) { score = 72; }
        else if (abilities.includes(T.ImageGeneration)) { score = 74; }
        else if (abilities.includes(T.VideoGeneration)) { score = 76; }
        else if (abilities.includes(T.AudioGeneration)) { score = 72; }
        else if (abilities.includes(T.BGM)) { score = 74; }
        else if (abilities.includes(T.MT)) {
            inctx = CTX.K32; outctx = DEFAULT_OUT; score = 73;
        }
        else { inctx = CTX.K8; score = 74; } // AudioUnderstanding 兜底
    } else {
        const spec = BASE_MODELS.find((s) => baseName.includes(s.match));
        if (spec) {
            abilities = [...spec.abilities];
            inctx = spec.inctx;
            outctx = spec.outctx;
            score = spec.score;
        } else {
            abilities = inferAbilitiesByKeyword(lower, null);
            if (abilities.includes(T.Embedding)) { inctx = CTX.K8; score = 72; }
            else if (abilities.includes(T.Rerank)) { score = 72; }
            else if (abilities.includes(T.ImageGeneration)) { score = 74; }
            else if (abilities.includes(T.VideoGeneration)) { score = 76; }
            else if (abilities.includes(T.AudioGeneration)) { score = 72; }
            else if (abilities.includes(T.AudioUnderstanding)) { inctx = CTX.K8; score = 74; }
            else if (abilities.includes(T.BGM)) { score = 74; }
            else if (abilities.includes(T.MT)) {
                inctx = CTX.K32; outctx = DEFAULT_OUT; score = 73;
            } else {
                inctx = DEFAULT_INCTX;
                outctx = abilities.includes(T.Reasoning) ? DEFAULT_REASON_OUT : DEFAULT_OUT;
                score = 72;
            }
        }
    }

    // 5. 版本标签
    appendVersionTags(lower, abilities);
    // 6. 能力/类别标签追加
    appendKeywordTags(lower, abilities);
    // 7. 一致性修正
    if (
        abilities.includes(T.TextGeneration) &&
        /thinking|think|reason|-r1\b|reasoner/.test(lower) &&
        !abilities.includes(T.Reasoning)
    ) {
        abilities.push(T.Reasoning);
    }
    if (
        (abilities.includes(T.Code) || abilities.includes(T.Math)) &&
        abilities.includes(T.TextGeneration) &&
        !abilities.includes(T.Reasoning)
    ) {
        abilities.push(T.Reasoning);
    }
    if (abilities.includes(T.Reasoning) && (!outctx || outctx < OUT.K16)) {
        outctx = DEFAULT_REASON_OUT;
    }
    // 8. 类别排他
    enforceCategoryExclusivity(abilities);
    // 9. 派生 Outline
    applyOutlineAbility(baseName, abilities);

    const finalAbilities = dedupe(abilities);
    const category = detectCategory(lower);

    return {
        rawId: raw,
        provider,
        baseName,
        versionOrDate,
        isSnapshot,
        abilities: finalAbilities,
        category,
        inctx,
        outctx,
        score,
    };
}

// ============================================================================
// 辅助函数
// ============================================================================

/**
 * 关键词推断 abilities。
 * @param earlyCategory 若已在 CATEGORY_SIGNALS 阶段命中类别，传入以确保不会回退为 chat 模型
 */
function inferAbilitiesByKeyword(
    lower: string,
    earlyCategory: ModelTags | null,
): ModelTags[] {
    const tags = new Set<ModelTags>();
    for (const { re, tag } of KEYWORD_TAGS) {
        if (re.test(lower)) tags.add(tag);
    }

    const isCategoryModel =
        earlyCategory !== null || CATEGORY_TAGS.some((c) => tags.has(c));

    if (!isCategoryModel) {
        // 通用 LLM 默认项：text-gen + tool
        tags.add(T.TextGeneration);
        tags.add(T.Tool);
    }
    if (tags.has(T.Code) || tags.has(T.Math)) {
        tags.add(T.Reasoning);
    }
    return Array.from(tags);
}

function appendVersionTags(lower: string, abilities: ModelTags[]): void {
    const hasVersionTag = abilities.some((a) => VERSION_TIER_TAGS.includes(a));
    if (hasVersionTag) return;
    for (const { re, tag } of VERSION_TAGS) {
        if (re.test(lower)) {
            abilities.push(tag);
            return;
        }
    }
}

function appendKeywordTags(lower: string, abilities: ModelTags[]): void {
    const set = new Set(abilities);
    const isCategoryModel = CATEGORY_TAGS.some((c) => set.has(c));
    for (const { re, tag } of KEYWORD_TAGS) {
        if (CATEGORY_TAGS.includes(tag)) {
            // 类别正则：始终允许加入（用于从纯类别模型派生准确的 category）
            if (re.test(lower)) set.add(tag);
            continue;
        }
        // 能力正则：类别模型跳过
        if (isCategoryModel) continue;
        if (re.test(lower)) set.add(tag);
    }
    abilities.length = 0;
    abilities.push(...set);
}

/**
 * 类别排他：
 * - AudioUnderstanding 可与 TextGeneration 等少数能力共存
 * - 其他类别完全剥离 LLM 功能标签
 */
function enforceCategoryExclusivity(abilities: ModelTags[]): void {
    const primary = CATEGORY_PRIORITY.find((c) => abilities.includes(c));
    if (!primary) return;

    if (primary === T.AudioUnderstanding) {
        const kept = abilities.filter(
            (a) => !LLM_FUNCTIONAL_TAGS.includes(a) ||
                AUDIO_UND_ALLOWED_TAGS.includes(a),
        );
        abilities.length = 0;
        abilities.push(...kept);
        return;
    }

    // 其他类别：完全剥离 LLM 功能标签
    const kept = abilities.filter((a) => !LLM_FUNCTIONAL_TAGS.includes(a));
    abilities.length = 0;
    abilities.push(...kept);
}

function applyOutlineAbility(baseName: string, abilities: ModelTags[]): void {
    if (!abilities.includes(T.TextGeneration)) return;
    const blocked = NO_OUTLINE_MATCHERS.some((m) => baseName.includes(m));
    if (blocked) return;
    if (!abilities.includes(T.Outline)) {
        abilities.push(T.Outline);
    }
}

function dedupe<T>(arr: T[]): T[] {
    return Array.from(new Set(arr));
}

// ============================================================================
// 便捷 API
// ============================================================================
export function getBaseModel(modelId: string): string {
    return parseModel(modelId)?.baseName ?? 'unknown';
}

export function hasAbility(modelId: string, tag: ModelTags): boolean {
    return parseModel(modelId)?.abilities.includes(tag) ?? false;
}

export function getModelCategory(modelId: string): ModelTags | 'unknown' {
    return parseModel(modelId)?.category ?? 'unknown';
}

export function supportsToolCalling(modelId: string): boolean {
    return hasAbility(modelId, ModelTags.Tool);
}

export function supportsConstrainedDecoding(modelId: string): boolean {
    return hasAbility(modelId, ModelTags.Outline);
}

export function isReasoningModel(modelId: string): boolean {
    return hasAbility(modelId, ModelTags.Reasoning);
}

export function isTranslationModel(modelId: string): boolean {
    return hasAbility(modelId, ModelTags.MT);
}

export function isCodeModel(modelId: string): boolean {
    return hasAbility(modelId, ModelTags.Code);
}

export function isMathModel(modelId: string): boolean {
    return hasAbility(modelId, ModelTags.Math);
}

export function isVideoGenerationModel(modelId: string): boolean {
    return hasAbility(modelId, ModelTags.VideoGeneration);
}

export function isAudioGenerationModel(modelId: string): boolean {
    return hasAbility(modelId, ModelTags.AudioGeneration);
}

export function isAudioUnderstandingModel(modelId: string): boolean {
    return hasAbility(modelId, ModelTags.AudioUnderstanding);
}

export function isBGMModel(modelId: string): boolean {
    return hasAbility(modelId, ModelTags.BGM);
}