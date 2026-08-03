import { PinyinFuseSearch, type SearchItem } from "$lib/utils/fuse";
import { allProtocols, type KnownProvider, type ProviderPreset } from "../../../../lib/utils/model/types";


export const KNOWN_PROVIDERS: KnownProvider = [
    {
        heading: "中国服务商",
        presets: [
            {
                id: "deepseek",
                label: "DeepSeek (深度求索)",
                protocol: allProtocols.deepseek,
                baseUrl: "https://api.deepseek.com",
                website: "https://platform.deepseek.com/api_keys",
                note: "探索人工通用智能（AGI）",
                maxconn: 500
            },
            {
                id: "qwen",
                label: "通义千问 (阿里云百炼)",
                protocol: allProtocols.alibaba,
                baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
                website: "https://bailian.console.aliyun.com/?apiKey=1#/api-key",
                note: "全栈企业级大模型服务平台",
                maxconn: 60
            },
            {
                id: "modelscope",
                label: "ModelScope 魔搭",
                protocol: allProtocols.openai,
                baseUrl: "https://modelscope.cn/api/v1",
                website: "https://modelscope.cn/my/apitoken",
                note: "阿里开源模型托管平台，海量开源模型API",
                maxconn: 60
            },
            {
                id: "siliconflow",
                label: "SiliconFlow (硅基流动)",
                protocol: allProtocols.openai,
                baseUrl: "https://api.siliconflow.cn/v1",
                website: "https://cloud.siliconflow.cn/account/ak",
                note: "提供更便宜、更快速的大模型平台",
                maxconn: 30
            },
            {
                id: "zhipu",
                label: "智谱 AI",
                protocol: allProtocols.openai,
                baseUrl: "https://open.bigmodel.cn/api/paas/v4",
                website: "https://open.bigmodel.cn/usercenter/apikeys",
                note: "让机器像人一样思考",
                maxconn: 30
            },
            {
                id: "moonshot",
                label: "月之暗面 (Kimi)",
                protocol: allProtocols.openai,
                baseUrl: "https://api.moonshot.cn/v1",
                website: "https://platform.moonshot.cn/console/api-keys",
                note: "寻求陪伴、探索世界的 AI 助手",
                maxconn: 30
            },
            {
                id: "doubao",
                label: "豆包大模型 (火山引擎)",
                protocol: allProtocols.openai,
                baseUrl: "https://ark.cn-beijing.volces.com/api/v3",
                website: "https://volcengine.com",
                note: "你的全能 AI 伙伴",
                maxconn: 30
            },
            {
                id: "wenxin",
                label: "文心一言 (百度智能云)",
                protocol: allProtocols.openaiCompatible,
                baseUrl: "https://qianfan.baidubce.com/v2",
                website: "https://baidu.com",
                note: "知识增强的大语言模型",
                maxconn: 30
            },
            {
                id: "hunyuan",
                label: "腾讯混元 (腾讯云)",
                protocol: allProtocols.openaiCompatible,
                baseUrl: "https://tokenhub.tencentmaas.com/v1",
                website: "https://console.cloud.tencent.com/tokenhub/apikey",
                note: "懂思维、擅创作、会编程的 AI 助手",
                maxconn: 30
            },
            {
                id: "baichuan",
                label: "百川智能",
                protocol: allProtocols.openai,
                baseUrl: "https://api.baichuan-ai.com/v1",
                website: "https://baichuan-ai.com",
                note: "致力于用中国智慧赋能世界",
                maxconn: 30
            },
            {
                id: "minimax",
                label: "MiniMax (海螺 AI)",
                protocol: allProtocols.anthropic,
                baseUrl: "https://api.minimaxi.com/anthropic",
                website: "https://minimaxi.com",
                note: "与用户共同陪伴、共同创造世界",
                maxconn: 30
            },
            {
                id: "spark",
                label: "讯飞星火 (科大讯飞)",
                protocol: allProtocols.openai,
                baseUrl: "https://spark-api-open.xf-yun.com/v1/",
                website: "https://xfyun.cn",
                note: "解放生产力，释放想象力",
                maxconn: 30
            },
            {
                id: "sensenova",
                label: "日日新 (商汤科技)",
                protocol: allProtocols.openai,
                baseUrl: "https://sensenova.cn",
                website: "https://www.sensetime.com",
                note: "大模型，新范式",
                maxconn: 30
            },
            {
                id: "stepfun",
                label: "阶跃星辰 (跃问)",
                protocol: allProtocols.openai,
                baseUrl: "https://api.stepfun.com/v1",
                website: "https://stepfun.com",
                note: "迈向通用人工智能的新阶跃",
                maxconn: 30
            }
        ]
    },
    {
        heading: "美国服务商",
        presets: [
            {
                id: "openai",
                label: "OpenAI",
                protocol: allProtocols.openai,
                baseUrl: "https://api.openai.com/v1",
                website: "https://platform.openai.com/api-keys",
                note: "构建安全、受益于全人类的通用人工智能（AGI）",
                maxconn: 30
            },
            {
                id: "anthropic",
                label: "Anthropic",
                protocol: allProtocols.anthropic,
                baseUrl: "https://api.anthropic.com",
                website: "https://console.anthropic.com/settings/keys",
                note: "构建以人类利益为核心、可靠、可解释的可控 AI 系统",
                maxconn: 30
            },
            {
                id: "google-gemini",
                label: "Google Gemini",
                protocol: allProtocols.vertex,
                baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai",
                website: "https://aistudio.google.com/apikey",
                note: "汇聚谷歌前沿技术、最具通用性的原生多模态大模型",
                maxconn: 30
            },
            {
                id: "mistral",
                label: "Mistral AI",
                protocol: allProtocols.openai,
                baseUrl: "https://api.mistral.ai/v1",
                website: "https://console.mistral.ai/api-keys/",
                note: "将前沿人工智能技术带向全行业，让大模型触手可及",
                maxconn: 30
            },
            {
                id: "groq",
                label: "Groq",
                protocol: allProtocols.openai,
                baseUrl: "https://api.groq.com/openai/v1",
                website: "https://console.groq.com/keys",
                note: "基于 LPU 技术，专为超低延迟、极速推理而生的算力平台",
                maxconn: 30
            },
            {
                id: "together",
                label: "Together AI",
                protocol: allProtocols.openai,
                baseUrl: "https://api.together.xyz/v1",
                website: "https://api.together.ai/settings/api-keys",
                note: "为全球开发者打造，性能更优、更高效的开源大模型云平台",
                maxconn: 30
            },
            {
                id: "openrouter",
                label: "OpenRouter",
                protocol: allProtocols.openai,
                baseUrl: "https://openrouter.ai/api/v1",
                website: "https://openrouter.ai/keys",
                note: "支持跨模型横向对比、自由切换的智能多模型聚合路由服务",
                maxconn: 30
            },
            {
                id: "xai",
                label: "xAI",
                protocol: allProtocols.xai,
                baseUrl: "https://api.x.ai/v1",
                website: "https://console.x.ai/",
                note: "打造能回答复杂宇宙问题的智能科技，深入探索世界本质",
                maxconn: 30
            },
            {
                id: "huggingface",
                label: "Hugging Face (Inference Providers)",
                protocol: allProtocols.openai,
                baseUrl: "https://api-inference.huggingface.co/v1",
                website: "https://huggingface.co",
                note: "汇聚全球开发者打造的 AI 开源社区",
                maxconn: 30
            }
        ]
    },
    {
        heading: "图片生成",
        presets: [
            {
                id: "liblib",
                label: "Liblib.art (哩布哩布)",
                protocol: allProtocols.openai,
                baseUrl: "https://openapi.liblibai.cloud",
                website: "https://www.liblib.art/apis",
                note: "AI 绘画模型分享与在线生图社区",
                maxconn: 5,
                models: [
                    {
                        id: "liblib-image-star-3",
                        description: "LiblibAI自研的下一代通用图像生成大模型，基于F.1基础算法架构，具备高精度图像生成与复杂提示词响应能力，色彩与艺术风格控制出色。",
                        label: "星流 Star-3"
                    },
                    {
                        id: "liblib-image-kontext",
                        description: "Kontext 图像生成模型，支持高质量的文生图与图生图生成任务。",
                        label: "Kontext"
                    },
                    {
                        id: "liblib-image-img1",
                        description: "Smart-Img1 智能图像生成模型，支持文生图与局部重绘（Inpaint）功能。",
                        label: "Smart Img1"
                    },
                    {
                        id: "liblib-image-seedream",
                        description: "Seedream V4 图像生成模型，提供高质量的图像生成服务。",
                        label: "Seedream V4"
                    },
                    {
                        id: "liblib-image-libedit",
                        description: "LibEdit 图像编辑模型，支持基础的图像编辑与修改任务。",
                        label: "LibEdit"
                    },
                    {
                        id: "liblib-image-libedit-v2",
                        description: "LibEdit V2 升级版图像编辑模型，提供更精细的图像编辑与修改能力。",
                        label: "LibEdit V2"
                    },
                    {
                        id: "liblib-image-dream",
                        description: "LibDream 图像生成模型，专注于创意与艺术风格的图像生成。",
                        label: "LibDream"
                    },
                    {
                        id: "liblib-image-qwen",
                        description: "基于 Qwen 模型的图像生成服务，支持文生图与图生图生成任务。",
                        label: "Qwen 图像生成"
                    },
                    {
                        id: "liblib-image-comfyui",
                        description: "基于 ComfyUI 的工作流图像生成模型，支持高度自定义的节点式生成任务。",
                        label: "ComfyUI 工作流"
                    }
                ]
            },
            {
                id: "stability",
                label: "Stability AI (Stable Diffusion)",
                protocol: allProtocols.openai,
                baseUrl: "https://api.stability.ai",
                website: "https://platform.stability.ai/account/keys",
                note: "Stable Diffusion 系列图像生成模型的官方服务",
                maxconn: 10
            }
        ]
    },
    {
        heading: "语音合成 (TTS)",
        presets: [
            {
                id: "elevenlabs",
                label: "ElevenLabs",
                protocol: allProtocols.openai,
                baseUrl: "https://api.elevenlabs.io/v1",
                website: "https://elevenlabs.io/app/settings/api-keys",
                note: "高拟真语音合成与声音克隆平台",
                maxconn: 10
            }
        ]
    },
    {
        heading: "语音识别 (ASR)",
        presets: [
            {
                id: "deepgram",
                label: "Deepgram",
                protocol: allProtocols.openai,
                baseUrl: "https://api.deepgram.com/v1",
                website: "https://console.deepgram.com",
                note: "低延迟、高准确率的语音转文字服务",
                maxconn: 10
            },
            {
                id: "assemblyai",
                label: "AssemblyAI",
                protocol: allProtocols.openai,
                baseUrl: "https://api.assemblyai.com/v2",
                website: "https://www.assemblyai.com",
                note: "面向开发者的语音识别与音频理解 API",
                maxconn: 10
            }
        ]
    },
    {
        heading: "本地部署",
        presets: [
            {
                id: "ollama",
                label: "Ollama (本地)",
                protocol: allProtocols.openai,
                baseUrl: "http://localhost:11434/v1",
                apiKey: "ollama",
                website: "",
                note: "本地部署，无需密钥",
                maxconn: 1
            },
            {
                id: "lmstudio",
                label: "LM Studio (本地)",
                protocol: allProtocols.openai,
                baseUrl: "http://localhost:1234/v1",
                apiKey: "lmstudio",
                website: "",
                note: "本地部署，无需密钥",
                maxconn: 1
            }
        ]
    }
];


/** 扁平化后的全部预设，供查找 / 索引复用（KNOWN_PROVIDERS 为静态常量，安全缓存） */
const ALL_PRESETS: ProviderPreset[] = KNOWN_PROVIDERS.flatMap((g) => g.presets);


export function findPreset(pid: string): ProviderPreset | null {
    return ALL_PRESETS.find((p) => p.id === pid) ?? null;
}


// ────────────────────────────────────────────────────────────
// 按 endpoint（baseUrl）定位预设
//
// 设计动机：Provider 的显示名称 / id 允许用户随时改动，唯有 baseUrl（服务端点）
// 是与预设强绑定、几乎不变的稳定锚点。因此需要「静态模型清单」等预设能力时，
// 应以 baseUrl 反查 preset，而非依赖易变的 id。
//
// 归一化策略（让 URL 的常见书写差异不影响匹配）：
//   · trim 首尾空白
//   · 统一转小写（域名/协议大小写不敏感）
//   · 去除末尾所有 `/`（"…/v1" 与 "…/v1/" 视为等价，如 spark 预设带尾斜杠）
// 不做更激进的规范化（如 query / 端口补全），避免误判把两个不同端点合并。
// ────────────────────────────────────────────────────────────
function normalizeBaseUrl(url: string | undefined | null): string {
    if (!url) return "";
    return url.trim().toLowerCase().replace(/\/+$/, "");
}

/** baseUrl → preset 的预构建索引（KNOWN_PROVIDERS 为静态常量，安全缓存） */
let _baseUrlIndex: Map<string, ProviderPreset> | null = null;

function getBaseUrlIndex(): Map<string, ProviderPreset> {
    if (_baseUrlIndex) return _baseUrlIndex;
     
    const idx = new Map<string, ProviderPreset>();
    for (const p of ALL_PRESETS) {
        const key = normalizeBaseUrl(p.baseUrl);
        // 若出现重复端点，保留首个（KNOWN_PROVIDERS 中当前无重复）
        if (key && !idx.has(key)) idx.set(key, p);
    }
    _baseUrlIndex = idx;
    return idx;
}

/**
 * 按服务端点（baseUrl）查找预设。
 * 名称可变、端点不变 —— 需要静态模型清单等预设能力时以此为准。
 * 未命中返回 null。
 */
export function findPresetByBaseUrl(baseUrl: string | undefined | null): ProviderPreset | null {
    const key = normalizeBaseUrl(baseUrl);
    if (!key) return null;
    return getBaseUrlIndex().get(key) ?? null;
}


// ────────────────────────────────────────────────────────────
// 预设提供商模糊搜索（中文 / 拼音全拼 / 首字母）
// 采用 create-on-demand：首次调用 searchPresets 时才构建全局 Fuse 索引，
// 避免模块加载阶段做不必要的拼音转换开销。
//
// 搜索范围覆盖：
//   · label   — 主键（权重最高，因为它是用户的核心识别目标）
//   · note    — 说明（低优先级补充；用户搜「AGI」「兼容 OpenAI」「本地」也能命中）
//   · id      — 内置 id（便于精确匹配 / 内部跳转）
//   · protocol / baseUrl  — 不纳入：URL/协议不在用户认知模型内，
//                           加入会污染短查询的排序。
//
// 由于 fuse.ts 把所有字段合并到单一 `text` 字段做拼音索引，无法表达权重，
// 故改用「构造多语料条目」策略：对每个预设生成「主文本」「副文本」两组条目，
// 主文本（label）单独放入以保证高权重命中，副文本（note 字段）也独立放入以
// 扩大召回；最终去重并保留与 label 首次出现一致的顺序。
// ────────────────────────────────────────────────────────────
let _presetFuse: PinyinFuseSearch | null = null;

function getPresetFuse(): PinyinFuseSearch {
    if (_presetFuse) return _presetFuse;
    const items: SearchItem[] = [];
    // 主语料：每个预设的 label → 高优匹配
    for (const p of ALL_PRESETS) {
        items.push({ id: p.id, text: p.label });
    }
    // 副语料：note 说明字段 → 低优补充召回
    for (const p of ALL_PRESETS) {
        if (p.note && p.note.trim()) {
            // 用「label||note」作为 note 的检索上下文，避免它被误当作独立条目；
            // fuse 会对整段 text 做分词/拼音索引，label 在前会让主键身份仍可命中。
            items.push({ id: p.id, text: `${p.label} ${p.note}` });
        }
    }
    _presetFuse = new PinyinFuseSearch(items);
    return _presetFuse;
}

/**
 * 模糊搜索预设提供商，返回按相关度排序的预设列表。
 * 空查询返回空数组（调用方据此回退到「分组全量展示」）。
 *
 * 实现要点：因索引里同一预设可能出现两次（label / note 各一条），
 * 这里用 Map 做 O(n) 去重，保留首次（label 主条目）出现的位置——即相关度
 * 更高的命中顺序。
 */
export function searchPresets(query: string): ProviderPreset[] {
    const q = query.trim();
    if (!q) return [];
    const ids = getPresetFuse().search(q);
    const seen = new Set<string>();
    const out: ProviderPreset[] = [];
    for (const id of ids) {
        const sid = String(id);
        if (seen.has(sid)) continue;
        seen.add(sid);
        const p = findPreset(sid);
        if (p) out.push(p);
    }
    return out;
}