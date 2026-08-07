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
// 类别默认规格（与 types.ts 的 FUNCTION_CONTEXT_LABELS 语义对齐）
// ============================================================================
/** 绘图默认能力：自然语言 / 人物 / 环境 */
const IMAGE_DEFAULT_ABILITIES: ModelTags[] = [T.NLP, T.HUMAN, T.ENV];
/** 视频生成默认能力：全能 / 首尾帧 / 多帧 */
const VIDEO_DEFAULT_ABILITIES: ModelTags[] = [T.OMNI, T.FF, T.MFF];
/** 绘图：素材数量（张） */
const IMAGE_DEFAULT_INCTX = 8;
/** 绘图：最大输出（张） */
const IMAGE_DEFAULT_OUTCTX = 4;
/** 视频生成：素材数量（个） */
const VIDEO_DEFAULT_INCTX = 10;
/** 视频生成：最大时长（秒） */
const VIDEO_DEFAULT_OUTCTX = 15;

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
// 类别优先级：决定剥离 chat 类时保留哪个类别，
// 同时也是「多词元命中冲突」时的消歧顺序
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
    T.G3D,   // 新增：3D 生成优先级排在 MT 之后
];

// ============================================================================
// 【第一优先】词元级类别检测（Token-based）
//
// 最佳实践：现代模型命名普遍以分隔符标注类别，如
//   hunyuan-image / qwen-image / wan2.2-t2v-plus / hunyuan-video /
//   gpt-4o-mini-tts / qwen-mt-turbo / text-embedding-3-large
// 因此第一道检查是：按 [-_/.:@空格] 拆分后对词元做「精确匹配」。
// 精确匹配不会像 substring 那样误伤（如 "imagen" 不含独立词元 "image"，
// 交由第二道正则兜底；"gpt" 不会命中 "mt"）。
// ============================================================================
const TOKEN_CATEGORY_MAP: Record<string, ModelTags> = {
    // —— 嵌入（含常见拼写错误 embeding）——
    embedding: T.Embedding,
    embeddings: T.Embedding,
    embeding: T.Embedding,
    embed: T.Embedding,
    // —— 重排 ——
    rerank: T.Rerank,
    reranker: T.Rerank,
    // —— 绘图 ——
    image: T.ImageGeneration,
    t2i: T.ImageGeneration,
    i2i: T.ImageGeneration,
    dalle: T.ImageGeneration,
    // —— 视频生成 ——
    video: T.VideoGeneration,
    t2v: T.VideoGeneration,
    i2v: T.VideoGeneration,
    // —— 语音合成 ——
    tts: T.AudioGeneration,
    t2s: T.AudioGeneration,
    // —— 语音识别 ——
    asr: T.AudioUnderstanding,
    stt: T.AudioUnderstanding,
    s2t: T.AudioUnderstanding,
    // —— 背景音乐 ——
    bgm: T.BGM,
    // —— 机器翻译 ——
    mt: T.MT,
    translation: T.MT,
    translate: T.MT,
    translator: T.MT,
    // —— 3D 生成 ——（新增）
    g3d: T.G3D,
    '3d': T.G3D,
    hyper3d: T.G3D,
    hitem3d: T.G3D,
};

const TOKEN_SPLIT_RE = /[-_/.:@\s]+/;

/**
 * 词元级类别检测：拆分 → 精确匹配 → 多命中时按 CATEGORY_PRIORITY 消歧。
 * 例："image-to-video" 同时命中 image 与 video，按优先级返回 VideoGeneration。
 */
function detectCategoryByToken(lower: string): ModelTags | null {
    const tokens = lower.split(TOKEN_SPLIT_RE).filter(Boolean);
    const hits = new Set<ModelTags>();
    for (const tok of tokens) {
        const tag = TOKEN_CATEGORY_MAP[tok];
        if (tag) hits.add(tag);
    }
    if (hits.size === 0) return null;
    for (const tag of CATEGORY_PRIORITY) {
        if (hits.has(tag)) return tag;
    }
    return null;
}

// ============================================================================
// 【第二兜底】类别关键词正则（覆盖无分隔词元的专有名称，
// 如 imagen / dall-e / whisper / cogvideo / musicgen）
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
    {
        tag: T.G3D,
        re: /\bg3d\b|hyper3d|hitem3d|(?<![a-zA-Z])3d(?![a-zA-Z])/
    },
];

/**
 * 类别检测总入口：
 *   1️⃣ 词元精确匹配（第一优先，覆盖 hunyuan-image / qwen-image 等命名规范）
 *   2️⃣ 正则关键词兜底（覆盖 imagen / whisper 等专有名称）
 */
function detectCategory(lower: string): ModelTags | null {
    const byToken = detectCategoryByToken(lower);
    if (byToken) return byToken;
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
    T.BGM, T.MT, T.G3D,   // 新增 G3D
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

    // 4. 【关键】先做类别检测（词元优先 → 正则兜底）
    //    命中则完全跳过 BASE_MODELS 的 chat 匹配。
    //    这样 hunyuan-image / qwen-image / hunyuan-video 等厂商多模态子系列
    //    不会因厂商前缀（hunyuan / qwen）而被误判为 LLM。
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
        // 类别模型默认规格（含 image/video 的默认子能力注入）
        const d = applyCategoryDefaults(abilities)
            ?? { inctx: CTX.K8, outctx: undefined, score: 74 }; // 理论不可达兜底
        inctx = d.inctx;
        outctx = d.outctx;
        score = d.score;
    } else {
        const spec = BASE_MODELS.find((s) => baseName.includes(s.match));
        if (spec) {
            abilities = [...spec.abilities];
            inctx = spec.inctx;
            outctx = spec.outctx;
            score = spec.score;
        } else {
            abilities = inferAbilitiesByKeyword(lower, null);
            const d = applyCategoryDefaults(abilities);
            if (d) {
                inctx = d.inctx;
                outctx = d.outctx;
                score = d.score;
            } else {
                // 通用 LLM 默认规格
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
    if (
        abilities.includes(T.TextGeneration) &&
        abilities.includes(T.Reasoning) &&
        (!outctx || outctx < OUT.K16)
    ) {
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

interface CategoryDefaults {
    inctx?: number;
    outctx?: number;
    score?: number;
}

/**
 * 类别模型的默认规格与默认子能力：
 * - 视频生成：注入 omni/ff/mff（全能/首尾帧/多帧），素材数量 4，最大时长 15s
 * - 绘图：注入 nlp/human/env（自然/人物/环境），素材数量 8，最大输出 4 张
 * - 其余类别：沿用原有的上下文/评分默认值
 * 命中类别返回默认规格；非类别模型返回 null（由调用方走 LLM 默认逻辑）。
 * 检查顺序对齐 CATEGORY_PRIORITY，确保多标签残留时以高优先级类别为准。
 */
function applyCategoryDefaults(abilities: ModelTags[]): CategoryDefaults | null {
    if (abilities.includes(T.Embedding)) {
        return { inctx: CTX.K8, outctx: undefined, score: 72 };
    }
    if (abilities.includes(T.Rerank)) {
        return { inctx: undefined, outctx: undefined, score: 72 };
    }
    if (abilities.includes(T.VideoGeneration)) {
        // 注入默认视频能力：全能 / 首尾帧 / 多帧
        for (const tag of VIDEO_DEFAULT_ABILITIES) {
            if (!abilities.includes(tag)) abilities.push(tag);
        }
        return {
            inctx: VIDEO_DEFAULT_INCTX,   // 素材数量：4 个
            outctx: VIDEO_DEFAULT_OUTCTX, // 最大时长：15 秒
            score: 76,
        };
    }
    if (abilities.includes(T.ImageGeneration)) {
        // 注入默认绘图流派：自然 / 人物 / 环境
        for (const tag of IMAGE_DEFAULT_ABILITIES) {
            if (!abilities.includes(tag)) abilities.push(tag);
        }
        return {
            inctx: IMAGE_DEFAULT_INCTX,   // 素材数量：8 张
            outctx: IMAGE_DEFAULT_OUTCTX, // 最大输出：4 张
            score: 74,
        };
    }
    if (abilities.includes(T.AudioUnderstanding)) {
        return { inctx: CTX.K8, outctx: undefined, score: 74 };
    }
    if (abilities.includes(T.AudioGeneration)) {
        return { inctx: undefined, outctx: undefined, score: 72 };
    }
    if (abilities.includes(T.BGM)) {
        return { inctx: undefined, outctx: undefined, score: 74 };
    }
    if (abilities.includes(T.MT)) {
        return { inctx: CTX.K32, outctx: DEFAULT_OUT, score: 73 };
    }
    // 新增：3D 生成默认规格
    if (abilities.includes(T.G3D)) {
        return { inctx: CTX.K8, outctx: undefined, score: 72 };
    }
    return null;
}

/**
 * 关键词推断 abilities。
 * @param earlyCategory 若已在类别检测阶段命中类别，传入以确保不会回退为 chat 模型
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
 * - 多类别共存时，仅保留 CATEGORY_PRIORITY 中最高优先级的那一个
 * 注意：image/video 的默认子能力（nlp/human/env、omni/ff/mff）
 * 不属于 LLM_FUNCTIONAL_TAGS，不会被此函数剥离。
 */
function enforceCategoryExclusivity(abilities: ModelTags[]): void {
    const primary = CATEGORY_PRIORITY.find((c) => abilities.includes(c));
    if (!primary) return;

    // 多类别命中时，剥离除 primary 之外的其他类别标签，
    // 避免出现「image-generation + video-generation」同时存在的脏数据
    const otherCategories = CATEGORY_TAGS.filter((c) => c !== primary);

    if (primary === T.AudioUnderstanding) {
        const kept = abilities.filter(
            (a) =>
                !otherCategories.includes(a) &&
                (!LLM_FUNCTIONAL_TAGS.includes(a) ||
                    AUDIO_UND_ALLOWED_TAGS.includes(a)),
        );
        abilities.length = 0;
        abilities.push(...kept);
        return;
    }

    // 其他类别：完全剥离 LLM 功能标签 + 其他类别标签
    const kept = abilities.filter(
        (a) => !LLM_FUNCTIONAL_TAGS.includes(a) && !otherCategories.includes(a),
    );
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