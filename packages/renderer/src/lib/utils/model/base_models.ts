// base_models.ts
export enum ModelTags {
    // —— 类别 ——
    Embedding = 'embedding',
    Rerank = 'rerank',
    TextGeneration = 'text-generation',
    ImageGeneration = 'image-generation',
    VideoGeneration = 'video-generation',
    AudioGeneration = 'audio-generation',
    AudioUnderstanding = 'audio-understanding',
    BGM = "bgm",
    MT = 'mt',
    // —— 版本区别 ——
    Ultra = 'ultra',
    Plus = 'plus',
    Flash = 'flash',
    Micro = 'micro',
    // —— 输入能力 ——
    Search = 'search',
    Reasoning = 'reasoning',
    Vision = 'vision',
    Video = 'video',
    Audio = 'audio',
    Tool = 'tool',
    Outline = 'outline',
    Math = 'math',
    Code = 'code',
    // 绘图流派
    NLP = "nlp",
    KBP = "KBP",
    CIP = "CIP",
    HUMAN = "human",
    ENV = "env",
    INSTRUCTION = "instruction",
    // 视频能力
    OMNI = "omni",
    FF = "ff",
    MFF = "mff",
}

const T = ModelTags;
// const CHAT_V = [T.TextGeneration, T.Tool, T.Vision];
const REASON = [T.TextGeneration, T.Tool, T.Reasoning];
const REASON_V = [T.TextGeneration, T.Tool, T.Reasoning, T.Vision];
const OMNI_R = [T.TextGeneration, T.Tool, T.Vision, T.Audio, T.Reasoning];

interface BaseSpec {
    match: string;
    abilities: ModelTags[];
    inctx?: number;
    outctx?: number;
    score?: number;
}

export const CTX = {
    K8: 8_192,
    K16: 16_384,
    K32: 32_768,
    K64: 65_536,
    K128: 131_072,
    K200: 200_000,
    K256: 262_144,
    K512: 524_288,
    M1: 1_000_000,
    M1_ACTUAL: 1_048_576,
    M2: 2_097_152,
    M10: 10_000_000,
} as const;

export const OUT = {
    K4: 4_096,
    K8: 8_192,
    K16: 16_384,
    K32: 32_768,
    K64: 65_536,
    K100: 100_000,
    K128: 131_072,
} as const;

/**
 * 仅保留"我确定且肯定"的 2026 年主流旗舰精确规格。
 * 其他模型一律交给 feature.ts 的规则系统推断。
 * 顺序敏感：更具体的模式必须放在前面。
 */
export const BASE_MODELS: BaseSpec[] = [
    // ===== OpenAI ——
    { match: 'gpt-5-mini', abilities: [...OMNI_R, T.Flash], inctx: CTX.K256, outctx: OUT.K128, score: 88 },
    { match: 'gpt-5-nano', abilities: [...OMNI_R, T.Micro], inctx: CTX.K256, outctx: OUT.K128, score: 82 },
    { match: 'gpt-5', abilities: [...OMNI_R], inctx: CTX.K256, outctx: OUT.K128, score: 95 },

    // ===== Anthropic ——
    { match: 'claude-opus-4', abilities: [...REASON_V, T.Ultra], inctx: CTX.K200, outctx: OUT.K32, score: 93 },
    { match: 'claude-sonnet-4', abilities: [...REASON_V, T.Plus], inctx: CTX.M1, outctx: OUT.K64, score: 90 },

    // ===== Google Gemini ——
    { match: 'gemini-2.5-pro', abilities: [...OMNI_R, T.Video, T.Plus], inctx: CTX.M1_ACTUAL, outctx: OUT.K64, score: 92 },
    { match: 'gemini-2.5-flash', abilities: [...OMNI_R, T.Video, T.Flash], inctx: CTX.M1_ACTUAL, outctx: OUT.K64, score: 86 },

    // ===== DeepSeek ——
    { match: 'deepseek-v4', abilities: [...REASON], inctx: CTX.M1, outctx: OUT.K64, score: 90 },

    // ===== Alibaba Qwen ——
    { match: 'qwen3-max', abilities: [...REASON_V, T.Ultra], inctx: CTX.M1, outctx: OUT.K32, score: 86 },

    // ===== xAI ——
    { match: 'grok-4', abilities: [...REASON_V, T.Search, T.Ultra], inctx: CTX.K256, outctx: OUT.K64, score: 92 },
];

/**
 * 厂商识别规则（关键词 → provider）。
 * feature.ts 中规则优先于 BASE_MODELS 兜底。
 */
export const PROVIDER_RULES: Array<{ provider: string; keywords: string[] }> = [
    { provider: 'openai', keywords: ['gpt', 'o1', 'o3', 'o4', 'chatgpt', 'dall-e', 'text-embedding', 'davinci', 'whisper', 'sora'] },
    { provider: 'anthropic', keywords: ['claude'] },
    { provider: 'google', keywords: ['gemini', 'gemma', 'imagen', 'palm', 'veo'] },
    { provider: 'alibaba', keywords: ['qwen', 'qwq', 'qvq', 'wan', 'tongyi', 'wanx'] },
    { provider: 'deepseek', keywords: ['deepseek'] },
    { provider: 'moonshot', keywords: ['moonshot', 'kimi'] },
    { provider: 'zhipu', keywords: ['glm', 'chatglm', 'cogview', 'cogvideo'] },
    { provider: 'baidu', keywords: ['ernie', 'wenxin'] },
    { provider: 'bytedance', keywords: ['doubao', 'seed', 'seedream', 'seedance'] },
    { provider: 'tencent', keywords: ['hunyuan'] },
    { provider: 'minimax', keywords: ['minimax', 'abab'] },
    { provider: 'xai', keywords: ['grok'] },
    { provider: 'meta', keywords: ['llama'] },
    { provider: 'mistral', keywords: ['mistral', 'mixtral', 'codestral', 'ministral', 'pixtral', 'magistral', 'devstral'] },
    { provider: 'baai', keywords: ['bge'] },
    { provider: 'jina', keywords: ['jina'] },
    { provider: '01ai', keywords: ['yi-'] },
    { provider: 'stepfun', keywords: ['step-'] },
    { provider: 'cohere', keywords: ['command', 'rerank', 'aya', 'embed-'] },
    { provider: 'microsoft', keywords: ['phi-', 'phi3', 'phi4'] },
    { provider: 'nvidia', keywords: ['nemotron', 'nvidia'] },
    { provider: 'inclusionai', keywords: ['ling-', 'ring-'] },
    { provider: 'baichuan', keywords: ['baichuan'] },
    { provider: 'sensetime', keywords: ['sensechat', 'nova'] },
    { provider: 'ibm', keywords: ['granite'] },
    { provider: 'perplexity', keywords: ['sonar', 'pplx'] },
];