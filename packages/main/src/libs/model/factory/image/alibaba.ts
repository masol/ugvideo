import { throwPrecondition } from '$libs/utils/err.js';
import type { Provider } from '$types/index.js';
import type {
    ImageModelV4,
    ImageModelV4CallOptions,
    ImageModelV4File,
    ImageModelV4Result,
    SharedV4Warning,
} from '@ai-sdk/provider';
import Logger from 'electron-log/main.js';
import type { ImageAdapterEntry } from './registry.js';

/**
 * 阿里云百炼(DashScope)生图兼容适配器。
 *
 * 背景:@ai-sdk/alibaba 的 imageModel() 用硬编码白名单校验 modelId,
 * 对 wan2.7-image-pro / z-image-turbo 等模型会在发请求前就抛 AI_NoSuchModelError。
 * 这里绕过 SDK,直接调用 DashScope 原生生图接口,并实现 ImageModelV4 契约,
 * 使上层 getSmartImage / fallback 逻辑无需改动。
 *
 * ── 端点统一处理:同步优先、异步兜底 ──────────────────────────────
 *   - 同步:POST /api/v1/services/aigc/multimodal-generation/generation
 *           单次请求直接返回图片(choices[].message.content[].image)
 *   - 异步:POST /api/v1/services/aigc/image-generation/generation
 *           (Header: X-DashScope-Async: enable)→ task_id → 轮询
 *           GET /api/v1/tasks/{task_id} → 同结构 choices[].message.content[].image
 * 两代端点提交体与成功响应结构相同,解析器 parseResultUrls 共用。
 * 先试同步,若 400/404 或空响应则切异步再试一次。
 *
 * ── size / aspectRatio 换算(关键)─────────────────────────────
 * DashScope 只认 size:"W*H"(星号)。若把 "2048x1152"(小写 x)原样发过去,
 * 服务端会忽略并回退到模型默认分辨率(z-image 默认 1024*1536,是竖图),
 * 表现为"请求横图却出竖图"。因此:
 *   - size 的三个来源(providerOptions.size / options.size / aspectRatio 换算)
 *     统一收敛为一个值,并**无条件**规范化为 "W*H";
 *   - 只给 aspectRatio 时,按「常用比例 × 推荐像素表」取最近项,
 *     未命中按 anchor 像素回推,始终保持横纵比。
 *
 * 图片 URL 24 小时过期,故下载为二进制返回,保证结果自包含。
 */

const ALIYUN_DOMAINS = ['aliyuncs.com', 'aliyun.com'];

const SYNC_PATH = '/api/v1/services/aigc/multimodal-generation/generation';
const ASYNC_SUBMIT_PATH = '/api/v1/services/aigc/image-generation/generation';
const TASK_PATH = '/api/v1/tasks';

const POLL_INTERVAL_MS = 10_000;
const MAX_POLL_MS = 30 * 60 * 1000;
const DEFAULT_MAX_IMAGES_PER_CALL = 4;

/** anchor 总像素,落在 z-image 推荐区间 [1024², 1536²] 内。 */
const ANCHOR_PIXELS = 1024 * 1024;

type HttpError = Error & { statusCode: number };

function makeHttpError(message: string, statusCode: number): HttpError {
    const err = new Error(message) as HttpError;
    err.statusCode = statusCode;
    return err;
}

/** "端点不可用"信号:据此切到另一条端点再试,不上抛。 */
class EndpointMismatchError extends Error { }

function abortError(): DOMException {
    return new DOMException('Aborted', 'AbortError');
}

function deriveOrigin(baseUrl: string): string {
    return new URL(baseUrl.trim()).origin;
}

function isAliyunHost(host: string): boolean {
    return ALIYUN_DOMAINS.some((d) => host === d || host.endsWith('.' + d));
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
    return new Promise<void>((resolve, reject) => {
        if (signal?.aborted) {
            reject(abortError());
            return;
        }
        const onAbort = () => {
            clearTimeout(timer);
            reject(abortError());
        };
        const timer = setTimeout(() => {
            signal?.removeEventListener('abort', onAbort);
            resolve();
        }, ms);
        signal?.addEventListener('abort', onAbort, { once: true });
    });
}

/** 统一解析成功响应里的图片 URL。两代端点同构。 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function parseResultUrls(data: any): string[] {
    const choices = data?.output?.choices;
    if (!Array.isArray(choices)) return [];
    const urls: string[] = [];
    for (const c of choices) {
        const content = c?.message?.content;
        if (!Array.isArray(content)) continue;
        for (const part of content) {
            if (typeof part?.image === 'string') urls.push(part.image);
        }
    }
    return urls;
}

interface EndpointKind {
    name: 'sync' | 'async';
    submitPath: string;
    headers: Record<string, string>;
}

const SYNC: EndpointKind = {
    name: 'sync',
    submitPath: SYNC_PATH,
    headers: { 'Content-Type': 'application/json' },
};

const ASYNC: EndpointKind = {
    name: 'async',
    submitPath: ASYNC_SUBMIT_PATH,
    headers: {
        'Content-Type': 'application/json',
        'X-DashScope-Async': 'enable',
    },
};

/**
 * 将 ImageModelV4File 转换为可直接发送给 DashScope 的 image 内容。
 * - type:'url' → 直接使用 url
 * - type:'file' 且 data 是 data URL → 直接使用
 * - type:'file' 且 data 是 base64 字符串 → 包装成 data URL
 * - type:'file' 且 data 是 Uint8Array → 转 base64 后包装成 data URL
 */
function fileToImagePart(file: ImageModelV4File): { image: string } | null {
    if (file.type === 'url') {
        return { image: file.url };
    }

    // type === 'file'
    const mediaType = file.mediaType || 'image/png';
    const data = file.data;

    // 已经是 data URL
    if (typeof data === 'string' && data.startsWith('data:')) {
        return { image: data };
    }

    // base64 字符串 → 包装成 data URL
    if (typeof data === 'string') {
        return { image: `data:${mediaType};base64,${data}` };
    }

    // Uint8Array → 转为 base64
    let binary = '';
    for (let i = 0; i < data.byteLength; i++) {
        binary += String.fromCharCode(data[i]);
    }
    const base64 = btoa(binary);
    return { image: `data:${mediaType};base64,${base64}` };
}

/** 构建包含文本和图片的 message content */
function buildMessageContent(
    prompt: string,
    referenceFiles?: ImageModelV4File[],
): Array<Record<string, string>> {
    const content: Array<Record<string, string>> = [];

    // 先添加参考图
    if (referenceFiles && referenceFiles.length > 0) {
        for (const file of referenceFiles) {
            const part = fileToImagePart(file);
            if (part) content.push(part);
        }
    }

    // 后添加文本提示词
    content.push({ text: prompt });

    return content;
}

function buildSubmitBody(
    modelId: string,
    prompt: string,
    parameters: Record<string, unknown>,
    referenceFiles?: ImageModelV4File[],
): Record<string, unknown> {
    return {
        model: modelId,
        input: {
            messages: [
                {
                    role: 'user',
                    content: buildMessageContent(prompt, referenceFiles),
                },
            ],
        },
        parameters,
    };
}

async function submitOnce(args: {
    origin: string;
    apiKey: string;
    endpoint: EndpointKind;
    modelId: string;
    prompt: string;
    parameters: Record<string, unknown>;
    referenceFiles?: ImageModelV4File[];
    signal?: AbortSignal;
}): Promise<{ urls: string[] } | { taskId: string }> {
    const { origin, apiKey, endpoint, modelId, prompt, parameters, referenceFiles, signal } =
        args;
    const body = buildSubmitBody(modelId, prompt, parameters, referenceFiles);
    const res = await fetch(`${origin}${endpoint.submitPath}`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${apiKey}`, ...endpoint.headers },
        body: JSON.stringify(body),
        signal,
    });

    const data = await res.json().catch(() => ({}));

    if (!res.ok) {
        if (res.status === 400 || res.status === 404) {
            throw new EndpointMismatchError(
                `端点 ${endpoint.name} 提交返回 ${res.status}: ${data?.message ?? ''}`,
            );
        }
        throw makeHttpError(
            `[alibaba-image] 提交生图失败 (${endpoint.name}): ${res.status} ${data?.message ?? res.statusText
            }`,
            res.status,
        );
    }

    const taskId = data?.output?.task_id;
    if (taskId) return { taskId };

    const urls = parseResultUrls(data);
    if (urls.length > 0) return { urls };

    throw new EndpointMismatchError(
        `端点 ${endpoint.name} 提交成功却无图片/任务: ${JSON.stringify(data?.output)}`,
    );
}

async function submit(args: {
    origin: string;
    apiKey: string;
    modelId: string;
    prompt: string;
    parameters: Record<string, unknown>;
    referenceFiles?: ImageModelV4File[];
    signal?: AbortSignal;
}): Promise<{ urls: string[] } | { taskId: string }> {
    const endpoints = [SYNC, ASYNC];
    let lastErr: unknown;
    for (let i = 0; i < endpoints.length; i++) {
        const ep = endpoints[i];
        const isLast = i === endpoints.length - 1;
        try {
            return await submitOnce({ ...args, endpoint: ep });
        } catch (e) {
            lastErr = e;
            if (!isLast && e instanceof EndpointMismatchError) {
                Logger.warn(`[alibaba-image] ${e.message},切换到另一条端点...`);
                continue;
            }
            throw e;
        }
    }
    throw lastErr;
}

async function pollTask(args: {
    origin: string;
    apiKey: string;
    taskId: string;
    signal?: AbortSignal;
}): Promise<string[]> {
    const { origin, apiKey, taskId, signal } = args;
    const deadline = Date.now() + MAX_POLL_MS;

    for (; ;) {
        if (signal?.aborted) throw abortError();

        const res = await fetch(`${origin}${TASK_PATH}/${taskId}`, {
            headers: { Authorization: `Bearer ${apiKey}` },
            signal,
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
            throw makeHttpError(
                `[alibaba-image] 查询生图任务失败: ${res.status} ${data?.message ?? res.statusText
                }`,
                res.status,
            );
        }

        const status: string | undefined = data?.output?.task_status;
        if (status === 'SUCCEEDED') {
            const urls = parseResultUrls(data);
            if (urls.length === 0) {
                throw new Error(
                    `[alibaba-image] 任务成功但未返回图片 URL: ${JSON.stringify(
                        data?.output,
                    )}`,
                );
            }
            return urls;
        }

        if (status === 'FAILED' || status === 'CANCELED' || status === 'UNKNOWN') {
            const code = data?.output?.code ?? '';
            const msg = data?.output?.message ?? data?.message ?? '';
            throw new Error(
                `[alibaba-image] 生图任务未成功 (${status})${code ? ` code=${code}` : ''
                }: ${msg}`,
            );
        }

        if (Date.now() > deadline) {
            throw new Error(`[alibaba-image] 生图任务轮询超时 (${MAX_POLL_MS}ms)`);
        }
        await sleep(POLL_INTERVAL_MS, signal);
    }
}

async function downloadImage(
    url: string,
    signal?: AbortSignal,
): Promise<Uint8Array> {
    const res = await fetch(url, { signal });
    if (!res.ok) {
        throw makeHttpError(
            `[alibaba-image] 下载生成图片失败: ${res.status} ${res.statusText}`,
            res.status,
        );
    }
    const buf = await res.arrayBuffer();
    return new Uint8Array(buf);
}

function collectParameters(
    providerOptions: ImageModelV4CallOptions['providerOptions'],
    provider: Provider,
): Record<string, unknown> {
    const merged: Record<string, unknown> = {};
    if (providerOptions) {
        for (const key of [provider.id, 'alibaba', 'dashscope']) {
            const v = providerOptions[key];
            if (v && typeof v === 'object') Object.assign(merged, v);
        }
    }
    return merged;
}

// ── size / aspectRatio 换算 ─────────────────────────────────────

/**
 * 把 "WxH"(分隔符可为 x/X/×/*)规范化为 DashScope 要求的 "W*H"。
 * 无法解析出两个正整数则返回 null。
 */
function normalizeExplicitSize(size: string): string | null {
    const m = size.match(/^\s*(\d+)\s*[xX×*]\s*(\d+)\s*$/);
    if (!m) return null;
    const w = parseInt(m[1], 10);
    const h = parseInt(m[2], 10);
    if (!Number.isFinite(w) || !Number.isFinite(h) || w <= 0 || h <= 0) return null;
    return `${w}*${h}`;
}

/** "W:H" → 浮点比例;失败返回 null。 */
function parseAspectRatio(ar: string): number | null {
    const m = ar.match(/^\s*(\d+(?:\.\d+)?)\s*:\s*(\d+(?:\.\d+)?)\s*$/);
    if (!m) return null;
    const w = parseFloat(m[1]);
    const h = parseFloat(m[2]);
    if (!Number.isFinite(w) || !Number.isFinite(h) || w <= 0 || h <= 0) return null;
    return w / h;
}

/** 文档推荐比例表(anchor≈1024²)。命中"最接近的"。 */
const RECOMMENDED_SIZES: Array<{ ratio: number; w: number; h: number }> = [
    { ratio: 1 / 1, w: 1024, h: 1024 },
    { ratio: 2 / 3, w: 832, h: 1248 },
    { ratio: 3 / 2, w: 1248, h: 832 },
    { ratio: 3 / 4, w: 864, h: 1152 },
    { ratio: 4 / 3, w: 1152, h: 864 },
    { ratio: 7 / 9, w: 896, h: 1152 },
    { ratio: 9 / 7, w: 1152, h: 896 },
    { ratio: 9 / 16, w: 720, h: 1280 },
    { ratio: 9 / 21, w: 576, h: 1344 },
    { ratio: 16 / 9, w: 1280, h: 720 },
    { ratio: 21 / 9, w: 1344, h: 576 },
];

/**
 * 由比例换算 "W*H":先查推荐表最近项;都不接近时按 anchor 像素回推,
 * 单边限制在 [256, 2048],始终保持横纵比。
 */
function sizeFromAspectRatio(ratio: number): string {
    let best = RECOMMENDED_SIZES[0];
    let bestDelta = Math.abs(Math.log(best.ratio) - Math.log(ratio));
    for (const item of RECOMMENDED_SIZES) {
        const d = Math.abs(Math.log(item.ratio) - Math.log(ratio));
        if (d < bestDelta) {
            bestDelta = d;
            best = item;
        }
    }
    // 比例与最近项足够接近就直接用表中值(像素与横纵比都在推荐范围内)
    if (bestDelta < 0.02) return `${best.w}*${best.h}`;

    // 否则按 anchor 像素回推,保持比例:w = sqrt(A * ratio), h = w / ratio
    let w = Math.round(Math.sqrt(ANCHOR_PIXELS * ratio));
    let h = Math.round(w / ratio);
    const clamp = (n: number) => Math.max(256, Math.min(2048, n));
    w = clamp(w);
    h = clamp(h);
    return `${w}*${h}`;
}

/**
 * 统一决策最终 size(始终返回 "W*H" 或 undefined)。
 * 优先级:显式 size(来自 providerOptions 或 options)> aspectRatio 换算。
 * 关键:任何显式 size 都强制规范化,杜绝 "x" 形式漏发导致服务端回退默认竖图。
 */
function resolveSize(
    rawSize: string | undefined,
    aspectRatio: string | undefined,
): string | undefined {
    if (rawSize) {
        const norm = normalizeExplicitSize(rawSize);
        if (norm) return norm;
        // 仍尽力把常见分隔符换成 *(退化路径,极少触发)
        return rawSize.replace(/[xX×]/g, '*');
    }
    if (aspectRatio) {
        const r = parseAspectRatio(aspectRatio);
        if (r != null) return sizeFromAspectRatio(r);
    }
    return undefined;
}

function createAlibabaImageModel(
    provider: Provider,
    modelId: string,
): ImageModelV4 {
    const apiKey = provider.apiKey ?? '';
    const origin = deriveOrigin(provider.baseUrl);

    return {
        specificationVersion: 'v4',
        provider: provider.id,
        modelId,
        maxImagesPerCall: DEFAULT_MAX_IMAGES_PER_CALL,

        async doGenerate(
            options: ImageModelV4CallOptions,
        ): Promise<ImageModelV4Result> {
            const startedAt = new Date();
            const warnings: SharedV4Warning[] = [];

            if (!options.prompt) {
                throwPrecondition('[alibaba-image] 百炼生图需要提供 prompt');
            }

            const parameters = collectParameters(options.providerOptions, provider);

            // ── size:三来源合并,统一规范化为 "W*H"(根因修复)──
            // providerOptions.size 也必须经过规范化,否则 "2048x1152" 会被服务端忽略,
            // 回退到模型默认(z-image 默认 1024*1536 竖图),表现为"横图请求出竖图"。
            const rawSize =
                (typeof parameters.size === 'string' ? parameters.size : undefined) ??
                options.size;
            const finalSize = resolveSize(rawSize, options.aspectRatio);
            if (finalSize) {
                parameters.size = finalSize;
            } else {
                // 没有任何 size 信息 → 不下发,交模型默认
                delete parameters.size;
            }
            if (options.size && options.aspectRatio) {
                warnings.push({
                    type: 'compatibility',
                    feature: 'aspectRatio',
                    details: '已按显式 size 输出,忽略 aspectRatio',
                });
            }

            // n>1:z-image 等模型固定 1 张;静默降为 1 并告警。
            if (options.n != null && options.n > 1) {
                if (parameters.n == null) parameters.n = 1;
                warnings.push({
                    type: 'compatibility',
                    feature: 'n',
                    details: '该模型固定输出 1 张,已忽略 n>1 的请求',
                });
            } else if (options.n != null && parameters.n == null) {
                parameters.n = options.n;
            }

            if (options.seed != null && parameters.seed == null) {
                parameters.seed = options.seed;
            }

            // ── 处理参考图 ──
            // ImageModelV4File: { type:'file', mediaType, data } | { type:'url', url }
            const referenceFiles = options.files;
            if (referenceFiles && referenceFiles.length > 0) {
                Logger.debug(
                    `[alibaba-image] 使用 ${referenceFiles.length} 张参考图`,
                );
            }

            if (options.mask) {
                warnings.push({
                    type: 'unsupported',
                    feature: 'mask',
                    details: '当前百炼文生图适配器不支持 mask,已忽略',
                });
            }

            Logger.debug(
                `[alibaba-image] 绕过 SDK,原生调用 ${provider.id}::${modelId} ` +
                `(端点候选:sync→async) 入参 size=${options.size ?? '-'} ` +
                `aspectRatio=${options.aspectRatio ?? '-'} ` +
                `referenceImages=${referenceFiles?.length ?? 0} ` +
                `→ 实发 parameters=${JSON.stringify(parameters)}`,
            );

            const submitted = await submit({
                origin,
                apiKey,
                modelId,
                prompt: options.prompt!,
                parameters,
                referenceFiles,
                signal: options.abortSignal,
            });

            const urls =
                'urls' in submitted
                    ? submitted.urls
                    : await pollTask({
                        origin,
                        apiKey,
                        taskId: submitted.taskId,
                        signal: options.abortSignal,
                    });

            const images = await Promise.all(
                urls.map((u) => downloadImage(u, options.abortSignal)),
            );

            return {
                images,
                warnings,
                response: {
                    timestamp: startedAt,
                    modelId,
                    headers: undefined,
                },
            };
        },
    };
}

export const alibabaImageAdapter: ImageAdapterEntry = {
    match: (host) => isAliyunHost(host),
    create: createAlibabaImageModel,
};