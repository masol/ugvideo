
/**
 * 模型核心能力枚举：用于调用方按任务场景（如代码生成、推理、轻量文本）筛选
 */
export enum ModelTags {
    Embedding = 'embedding',
    Rerank = 'rerank',
    TextGeneration = 'text-generation',
    MT = "mt", // 机器翻译优化。
    ImageGeneration = 'image-generation', // 图像生成。
    VideoGeneration = 'video-generation',   // ← 新增
    AudioGeneration = 'audio-generation',   // ← 新增（语音合成 TTS）
    AudioUnderstanding = 'audio-understanding', // ← 新增（ASR / 语音理解）    
    BGM = "bgm",
    // 以上为类别。

    // CodeGeneration = 'code-generation',
    // 以上为垂直细分，暂未引入，拟定使用单独字段存储任意标签。
    Ultra = 'ultra',  // 旗舰版
    Plus = 'plus', // 专业版。
    Flash = 'flash', // 轻量版。
    Micro = 'micro', // 端侧版。
    // 以上为版本区别。

    Search = 'search', // 自带联网搜索能力。
    Reasoning = 'reasoning', // 思考模式。
    Vision = 'vision', // 视觉理解
    Video = "video",   // 视频理解
    Tool = "tool", // 函数调用(工具)
    Audio = 'audio', // 语音理解
    Outline = "outline", // 支持结构化输出。
    Math = "math", // 数学推理优化。
    Code = "code", // 代码生成优化。
    // 以上为LLM能力。

    NLP = "nlp", // 提示词流派：Natural Language Prompting
    KBP = "KBP", // 提示词流派：Keyphrase-Based Prompting
    CIP = "CIP", // 提示词流派：Command-Injected Prompting
    HUMAN = "human", // 擅长人物
    ENV = "env", // 擅长环境
    INSTRUCTION = "instruction", // 擅长指令跟随。

    // 以上为绘图能力。

    OMNI = "omni", // 支持全能参考。
    FF = "ff", // 支持首尾帧。
    MFF = "mff", // 支持多帧。
    //以上为视频能力。
}

/**
 * 接口协议枚举：区分不同的调用标准
 */
export enum ProviderProtocol {
    Deepseek = "deepseek",
    OpenAICompatible = "openai-compatible",
    OpenAI = 'openai',
    Anthropic = 'anthropic',
    GoogleVertex = 'google-vertex',
    Xai = 'xai',
    alibaba = "alibaba"
}

/**
 * 支持的输入/输出模态
 */
// export type Modality = 'text' | 'image' | 'audio' | 'video';

/**
 * 计费模式：免费、按 Token 计费、按次数计费、本地免费
 */
// export type PricingType = 'free' | 'per-token' | 'per-request' | 'local';

export interface Model {
    id: string;              // 唯一标识符（例如: "gpt-4o", "deepseek-reasoner"）
    abilities: ModelTags[]; // 模型固定标签，包括了能力，功能以及版本。
    // inputModalities: Modality[];  // 输入模态
    // outputModalities: Modality[]; // 输出模态

    // 上下文与限制
    inctx?: number;           // 输入上下文窗口 (Tokens)
    outctx?: number;          // 最大输出限制 (Tokens)
    score?: number;           // 能力评分

    // 计费扩展
    // pricingType?: PricingType;
    // incost_1m?: number;      // 每百万输入 Token 的费用（美元/人民币）
    // outcost_1m?: number;     // 每百万输出 Token 的费用（美元/人民币）

    // 状态控制
    // isLocal: boolean;        // 是否为本地运行模型（如 Ollama）
}

export interface Provider {
    id: string;              // 唯一标识（例如: "openai", "local-ollama"）id被当作名称来处理了。 
    protocol?: ProviderProtocol; // 接口协议枚举
    baseUrl: string;
    apiKey?: string;         // 部分本地服务商可选
    maxConn?: number;    // 服务商级别的全局最大并发数 (账户总并发限制--maxConnections,不再设置RPC/TPM)        
    // 网络配置
    proxyUrl?: string;       // 独立代理设置
    headers?: Record<string, string>; // 自定义请求头
    disabled?: boolean,
    models: Model[];         // 该服务商持有的模型列表
}

/**
 * 远端拉取的「可选模型」条目，适配 Command 组件。
 * id 作为 value；label/description 用于展示与搜索；
 * preset 为选中后自动填充表单的数据。
 */
export interface ModelOption {
    id: string;
    label?: string;
    description?: string;
    group?: string;
    preset?: Partial<Model>;
}