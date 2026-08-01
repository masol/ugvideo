// types.ts
import type { ModelTags, Provider, ProviderProtocol } from "@app/main/types";
import {
    IconArrowsLeftRight,
    IconArrowsSort,
    IconBolt,
    IconBrain,
    IconBrandGoogle,
    IconBrandOpenai,
    IconCirclePlus,
    IconCloud,
    IconCode,
    IconCommand,
    IconCpu,
    IconDatabase,
    IconDeviceDesktop,
    IconDiamond,
    IconDisc, // BGM
    IconEye,
    IconFileText,
    IconHash,
    IconJson,
    IconLanguage,
    IconLayoutGrid,
    IconMathFunction,
    IconMessage,
    IconMicrophone2, // AudioUnderstanding
    IconMoodSmile,
    IconMountain,
    IconMovie, // VideoGeneration
    IconMusic, // AudioGeneration
    IconPhoto,
    IconSparkles,
    IconStack,
    IconTemplate,
    IconTool,
    IconUser,
    IconVideo, // 视频理解能力
    IconVolume, // Audio 能力
    IconWorld,
} from "@tabler/icons-svelte";

export type { Model, ModelOption } from "@app/main/types";
export type { ModelTags as ModelAbility, ProviderProtocol };
export type ProviderConfig = Omit<Provider, "models">

export function getProviderIcon(provider: Provider): typeof IconCloud {
    const id = provider.id.toLowerCase();
    const url = provider.baseUrl.toLowerCase();
    if (id.includes("openai") || url.includes("openai")) return IconBrandOpenai;
    if (id.includes("anthropic") || url.includes("anthropic")) return IconSparkles;
    if (id.includes("deepseek") || url.includes("deepseek")) return IconBolt;
    if (id.includes("google") || id.includes("vertex") || url.includes("googleapis")) return IconBrandGoogle;
    if (id.includes("huggingface") || id.includes("hf")) return IconMoodSmile;
    if (id.includes("ollama") || url.includes("localhost") || url.includes("127.0.0.1")) return IconDeviceDesktop;
    return IconCloud;
}

export const tagLabels: Record<ModelTags, string> = {
    "text-generation": "文本",
    "image-generation": "绘图",
    "video-generation": "视频生成",
    "audio-generation": "语音合成",
    "audio-understanding": "语音识别",
    "embedding": "嵌入",
    "rerank": "重排",
    "bgm": "背景音乐",
    "ultra": "旗舰版",
    "plus": "专业版",
    "flash": "轻量版",
    "micro": "端侧版",
    "search": "联网",
    "reasoning": "思考",
    "vision": "图像",
    "audio": "音频",
    "tool": "工具",
    "video": "视频理解",
    "outline": "格式",
    'math': "数学",
    'code': "代码",
    'mt': "翻译",
    // —— 绘图流派 ——
    'nlp': "自然",
    'KBP': "关键词",
    'CIP': "注入",
    'human': "人物",
    'env': "环境",
    'instruction': "跟随",
    // —— 视频能力 ——
    'omni': "全能",
    'ff': "首尾帧",
    'mff': "多帧",
};

export const tagIcons: Record<ModelTags, typeof IconMessage> = {
    "text-generation": IconMessage,
    "image-generation": IconPhoto,
    "video-generation": IconMovie,
    "audio-generation": IconMusic,
    "audio-understanding": IconMicrophone2,
    "embedding": IconDatabase,
    "rerank": IconArrowsSort,
    "bgm": IconDisc,
    "ultra": IconDiamond,
    "plus": IconCirclePlus,
    "flash": IconBolt,
    "micro": IconCpu,
    "search": IconWorld,
    "reasoning": IconBrain,
    "vision": IconEye,
    "audio": IconVolume,
    "tool": IconTool,
    "video": IconVideo,
    "outline": IconJson,
    'math': IconMathFunction,
    'code': IconCode,
    'mt': IconLanguage,
    // —— 绘图流派 ——
    'nlp': IconFileText,
    'KBP': IconHash,
    'CIP': IconCommand,
    'human': IconUser,
    'env': IconMountain,
    'instruction': IconTemplate,
    // —— 视频能力 ——
    'omni': IconLayoutGrid,
    'ff': IconArrowsLeftRight,
    'mff': IconStack,
};

export const FUNCTION_TAGS: Record<string, ModelTags> = {
    text: 'text-generation' as ModelTags,
    image: 'image-generation' as ModelTags,
    video: 'video-generation' as ModelTags,
    audioGen: 'audio-generation' as ModelTags,
    audioUnd: 'audio-understanding' as ModelTags,
    bgm: 'bgm' as ModelTags,
    embedding: 'embedding' as ModelTags,
    rerank: 'rerank' as ModelTags,
    mt: 'mt' as ModelTags,
};

export const VERSION_TAGS: Record<string, ModelTags> = {
    ultra: 'ultra' as ModelTags,
    plus: 'plus' as ModelTags,
    flash: 'flash' as ModelTags,
    micro: 'micro' as ModelTags,
}

export const CAPABILITY_TAGS: Record<string, ModelTags> = {
    search: 'search' as ModelTags,
    reasoning: 'reasoning' as ModelTags,
    vision: 'vision' as ModelTags,
    audio: 'audio' as ModelTags,
    tool: 'tool' as ModelTags,
    video: 'video' as ModelTags,
    outline: 'outline' as ModelTags,
    math: 'math' as ModelTags,
    code: 'code' as ModelTags,
};

// 绘图流派（仅 image function 下可选）
export const IMAGE_FUNCTION_TAGS: Record<string, ModelTags> = {
    nlp: 'nlp' as ModelTags,
    kbp: 'KBP' as ModelTags,
    cip: 'CIP' as ModelTags,
    human: 'human' as ModelTags,
    env: 'env' as ModelTags,
    instruction: 'instruction' as ModelTags,
};

// 视频能力（仅 video function 下可选）
export const VIDEO_FUNCTION_TAGS: Record<string, ModelTags> = {
    omni: 'omni' as ModelTags,
    ff: 'ff' as ModelTags,
    mff: 'mff' as ModelTags,
};

/**
 * 函数 → 该函数下允许被附加的能力标签全集。
 * 切换 function 时，UI 只渲染此集合内的 chips；
 * `normalize` 也据此过滤掉跨 function 残留的旧 tag。
 */
export const FUNCTION_CAPABILITIES: Partial<Record<ModelTags, ModelTags[]>> = {
    [FUNCTION_TAGS.text]: Object.values(CAPABILITY_TAGS),
    [FUNCTION_TAGS.image]: Object.values(IMAGE_FUNCTION_TAGS),
    [FUNCTION_TAGS.video]: Object.values(VIDEO_FUNCTION_TAGS),
};

/**
 * 函数 → 切换到此函数时默认勾选的能力标签。
 * 仅 image / video 有流派默认；text 默认在 ModelConfigDialog 初始化时处理。
 */
export const FUNCTION_DEFAULT_ABILITIES: Partial<Record<ModelTags, ModelTags[]>> = {
    [FUNCTION_TAGS.text]: [
        CAPABILITY_TAGS.tool,
        CAPABILITY_TAGS.reasoning,
    ],
    [FUNCTION_TAGS.image]: [
        IMAGE_FUNCTION_TAGS.nlp,
        IMAGE_FUNCTION_TAGS.human,
        IMAGE_FUNCTION_TAGS.env,
    ],
    [FUNCTION_TAGS.video]: [
        VIDEO_FUNCTION_TAGS.omni,
        VIDEO_FUNCTION_TAGS.ff,
        VIDEO_FUNCTION_TAGS.mff,
    ],
};

/**
 * 函数 → ModelConfigDialog 中"最大输入 / 最大输出"字段的语义标签。
 * showInctx/showOutctx=false 时该字段隐藏。
 */
export interface ContextFieldLabels {
    inctxLabel: string;
    inctxHint: string;
    outctxLabel: string;
    outctxHint: string;
    showInctx: boolean;
    showOutctx: boolean;
}

export const FUNCTION_CONTEXT_LABELS: Partial<Record<ModelTags, ContextFieldLabels>> = {
    [FUNCTION_TAGS.text]: {
        inctxLabel: "最大输入",
        inctxHint: "Tokens",
        outctxLabel: "最大输出",
        outctxHint: "Tokens",
        showInctx: true,
        showOutctx: true,
    },
    [FUNCTION_TAGS.image]: {
        inctxLabel: "素材数量",
        inctxHint: "张",
        outctxLabel: "最大输出",
        outctxHint: "K",
        showInctx: true,
        showOutctx: true,
    },
    [FUNCTION_TAGS.video]: {
        inctxLabel: "素材数量",
        inctxHint: "个",
        outctxLabel: "最大时长",
        outctxHint: "秒 (s)",
        showInctx: true,
        showOutctx: true,
    },
    [FUNCTION_TAGS.embedding]: {
        inctxLabel: "输入长度",
        inctxHint: "Tokens",
        outctxLabel: "",
        outctxHint: "",
        showInctx: true,
        showOutctx: false,
    },
    [FUNCTION_TAGS.mt]: {
        inctxLabel: "输入长度",
        inctxHint: "Tokens",
        outctxLabel: "输出长度",
        outctxHint: "Tokens",
        showInctx: true,
        showOutctx: true,
    },
    [FUNCTION_TAGS.audioUnd]: {
        inctxLabel: "最大长度",
        inctxHint: "秒",
        outctxLabel: "",
        outctxHint: "",
        showInctx: true,
        showOutctx: false,
    },
    [FUNCTION_TAGS.audioGen]: {
        inctxLabel: "",
        inctxHint: "",
        outctxLabel: "",
        outctxHint: "",
        showInctx: false,
        showOutctx: false,
    },
    [FUNCTION_TAGS.bgm]: {
        inctxLabel: "",
        inctxHint: "",
        outctxLabel: "",
        outctxHint: "",
        showInctx: false,
        showOutctx: false,
    },
    [FUNCTION_TAGS.rerank]: {
        inctxLabel: "",
        inctxHint: "",
        outctxLabel: "",
        outctxHint: "",
        showInctx: false,
        showOutctx: false,
    },
};

export const protocolLabels: Record<ProviderProtocol, string> = {
    "openai-compatible": "OpenAI兼容",
    "openai": "OpenAI",
    "anthropic": "Anthropic",
    "google-vertex": "Google AI",
    "xai": "xai",
    "ollama": "Ollama",
    "huggingface": "HuggingFace",
    "deepseek": "Deepseek",
};

export const allProtocols: Record<string, ProviderProtocol> = {
    openaiCompatible: "openai-compatible" as ProviderProtocol,
    openai: "openai" as ProviderProtocol,
    anthropic: "anthropic" as ProviderProtocol,
    vertex: "google-vertex" as ProviderProtocol,
    xai: "xai" as ProviderProtocol,
    ollama: "ollama" as ProviderProtocol,
    huggingface: "huggingface" as ProviderProtocol,
    deepseek: "deepseek" as ProviderProtocol
};

export function formatTokens(n: number): string {
    return new Intl.NumberFormat('en-US', {
        notation: 'compact',
        compactDisplay: 'short',
        maximumFractionDigits: 1
    }).format(n);
}

export interface ProviderPreset {
    id: string;
    label: string;
    protocol: ProviderProtocol;
    baseUrl: string;
    website: string;
    maxconn: number;
    note: string;
}

export type KnownProvider = Array<{
    heading: string,
    presets: ProviderPreset[]
}>

export const FUNCTION_ABILITIES: ModelTags[] = Object.values(FUNCTION_TAGS);
export const VERSION_ABILITIES: ModelTags[] = Object.values(VERSION_TAGS);
export const CAPABILITY_ABILITIES: ModelTags[] = Object.values(CAPABILITY_TAGS);
export const IMAGE_FUNCTION_ABILITIES: ModelTags[] = Object.values(IMAGE_FUNCTION_TAGS);
export const VIDEO_FUNCTION_ABILITIES: ModelTags[] = Object.values(VIDEO_FUNCTION_TAGS);
export const ALL_ABILITIES: ModelTags[] = [
    ...FUNCTION_ABILITIES,
    ...VERSION_ABILITIES,
    ...CAPABILITY_ABILITIES,
    ...IMAGE_FUNCTION_ABILITIES,
    ...VIDEO_FUNCTION_ABILITIES,
];