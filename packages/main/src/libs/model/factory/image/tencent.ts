import { throwPrecondition } from '$libs/utils/err.js';
import type { Provider } from '$types/index.js';
import type {
    ImageModelV4,
    ImageModelV4CallOptions,
    ImageModelV4Result,
    SharedV4Warning,
} from '@ai-sdk/provider';
import Logger from 'electron-log/main.js';
import type { ImageAdapterEntry } from './registry.js';

/**
 * 腾讯混元生图(TokenHub / tencentmaas)兼容适配器。
 *
 * 背景:vercel ai sdk 不认识 hy-image-* 模型;这里绕过 SDK,直接调用
 * TokenHub 的 OpenAI 兼容端点,并实现 ImageModelV4 契约,
 * 使上层 getSmartImage / fallback 逻辑无需改动。
 *
 * ── 端点与路由 ─────────────────────────────────────────────────
 *   - 极速版(同步):POST {origin}/v1/api/image/lite → {data:[{url}]}
 *   - 混元 3.0(异步,支持参考图 images):
 *       提交 POST {origin}/v1/api/image/submit → {id, status:"queued"}
 *       查询 POST {origin}/v1/api/image/query → {status, data:[{url}]}
 * 路由:有参考图强制 submit/query(图生图);否则 modelId 含 lite → 同步 /lite;
 *       否则 → 异步 submit/query。
 *
 * ── resolution 换算(关键约束)─────────────────────────────────
 * 腾讯 resolution 为 "宽:高"(冒号、像素值),且有硬约束:
 *   宽、高均在 [512, 2048] 且 **宽高乘积 ≤ 1024×1024(=1,048,576)**。
 * 超预算会报 InvalidParameter(如 2048:1152 = 235万像素,超一倍)。
 * 因此不能直接把上游 size 透传——统一按"比例最接近"snap 到腾讯官方尺寸列表,
 * 列表中每一项都满足边长与像素预算约束,保证合法且保持横纵比。
 *
 * 结果 URL 有效期约 1 小时,故下载为二进制返回,保证结果自包含。
 *
 * ── 瞬态错误处理 ───────────────────────────────────────────────
 * 502/503/504/429 等归为瞬态,同端点最多重试 2 次,并对每次网络调用套
 * AbortSignal.timeout。非瞬态错误(400/401/任务级 FAILED)直接上抛给上层 fallback。
 */

const TENCENT_DOMAIN = 'tencentmaas.com';

const LITE_PATH = '/v1/api/image/lite';
const SUBMIT_PATH = '/v1/api/image/submit';
const QUERY_PATH = '/v1/api/image/query';

const POLL_INTERVAL_MS = 5_000;
const MAX_POLL_MS = 5 * 60 * 1000;
const DEFAULT_MAX_IMAGES_PER_CALL = 1;

const SUBMIT_TIMEOUT_MS = 60_000;
const QUERY_TIMEOUT_MS = 30_000;
const DOWNLOAD_TIMEOUT_MS = 30_000;

const TRANSIENT_RETRIES = 2;
const TRANSIENT_BACKOFF_MS = 1_500;

/**
 * 腾讯官方尺寸列表(文档给定)。每一项都满足:边长∈[512,2048] 且 宽*高≤1024×1024。
 * 上游 size / aspectRatio 一律按"比例最接近"snap 到此表,保证合法。
 */
const TENCENT_SIZE_LIST: Array<[number, number]> = [
    [2048, 512], [1984, 512], [1920, 512], [1856, 512], [1792, 512],
    [1728, 512], [1664, 512], [1600, 512], [1536, 512], [1472, 576],
    [1408, 640], [1344, 704], [1280, 768], [1216, 832], [1152, 896],
    [1088, 960], [1024, 1024], [960, 1088], [896, 1152], [832, 1216],
    [768, 1280], [704, 1344], [640, 1408], [576, 1472], [512, 1536],
    [512, 1600], [512, 1664], [512, 1728], [512, 1792], [512, 1856],
    [512, 1920], [512, 1984], [512, 2048], [768, 1024], [720, 1280],
    [1024, 768], [1280, 720],
];

type HttpError = Error & { statusCode: number };

function makeHttpError(message: string, statusCode: number): HttpError {
    const err = new Error(message) as HttpError;
    err.statusCode = statusCode;
    return err;
}

function abortError(): DOMException {
    return new DOMException('Aborted', 'AbortError');
}

function deriveOrigin(baseUrl: string): string {
    return new URL(baseUrl.trim()).origin;
}

function isTencentHost(host: string): boolean {
    return host === TENCENT_DOMAIN || host.endsWith('.' + TENCENT_DOMAIN);
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

function withTimeout(parent: AbortSignal | undefined, ms: number): AbortSignal {
    if (!parent) return AbortSignal.timeout(ms);
    if (typeof AbortSignal.any === 'function') {
        return AbortSignal.any([parent, AbortSignal.timeout(ms)]);
    }
    return parent;
}

function isTransientStatus(status: number): boolean {
    return status === 408 || status === 425 || status === 429
        || status === 500 || status === 502 || status === 503 || status === 504;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function parseResultUrls(data: any): string[] {
    const arr = data?.data;
    if (!Array.isArray(arr)) return [];
    const urls: string[] = [];
    for (const item of arr) {
        if (typeof item?.url === 'string') urls.push(item.url);
    }
    return urls;
}

async function downloadImage(
    url: string,
    signal?: AbortSignal,
): Promise<Uint8Array> {
    const sig = withTimeout(signal, DOWNLOAD_TIMEOUT_MS);
    const res = await fetch(url, { signal: sig });
    if (!res.ok) {
        throw makeHttpError(
            `[tencent-image] 下载生成图片失败: ${res.status} ${res.statusText}`,
            res.status,
        );
    }
    const buf = await res.arrayBuffer();
    return new Uint8Array(buf);
}

// ── 参考图归一化 ───────────────────────────────────────────────
type FileArg = NonNullable<ImageModelV4CallOptions['files']>[number];

function uint8ToBase64(u8: Uint8Array): string {
    return Buffer.from(u8).toString('base64');
}

function toImageRef(file: FileArg): string | null {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const f = file as any;
    if (typeof f === 'string') return f;
    if (f instanceof Uint8Array) return uint8ToBase64(f);
    const data = f?.url ?? f?.data ?? f?.image;
    if (typeof data === 'string') return data;
    if (data instanceof Uint8Array) return uint8ToBase64(data);
    return null;
}

function collectImageRefs(files: ImageModelV4CallOptions['files']): string[] {
    if (!files || files.length === 0) return [];
    const refs: string[] = [];
    for (const f of files) {
        const r = toImageRef(f);
        if (r) refs.push(r);
    }
    return refs.slice(0, 3);
}

// ── resolution 换算:一律 snap 到官方尺寸列表 ──────────────────

/** 从 "WxH"/"W*H"/"W:H" 解析出宽高比;失败返回 null。 */
function ratioFromSize(size: string): number | null {
    const m = size.match(/^\s*(\d+)\s*[xX×*:]\s*(\d+)\s*$/);
    if (!m) return null;
    const w = parseInt(m[1], 10);
    const h = parseInt(m[2], 10);
    if (!Number.isFinite(w) || !Number.isFinite(h) || w <= 0 || h <= 0) return null;
    return w / h;
}

/** 从 "W:H" 解析宽高比(容许小数);失败返回 null。 */
function ratioFromAspect(ar: string): number | null {
    const m = ar.match(/^\s*(\d+(?:\.\d+)?)\s*:\s*(\d+(?:\.\d+)?)\s*$/);
    if (!m) return null;
    const w = parseFloat(m[1]);
    const h = parseFloat(m[2]);
    if (!Number.isFinite(w) || !Number.isFinite(h) || w <= 0 || h <= 0) return null;
    return w / h;
}

/** 按比例(对数距离)从官方尺寸列表取最接近项 → "W:H"。 */
function snapToSizeList(ratio: number): string {
    let best = TENCENT_SIZE_LIST[0];
    let bestDelta = Infinity;
    for (const [w, h] of TENCENT_SIZE_LIST) {
        const d = Math.abs(Math.log(w / h) - Math.log(ratio));
        if (d < bestDelta) {
            bestDelta = d;
            best = [w, h];
        }
    }
    return `${best[0]}:${best[1]}`;
}

/**
 * 决策 resolution:显式 size 优先取其比例,否则 aspectRatio;皆无则 undefined。
 * 无论来源,最终都 snap 到官方尺寸列表,确保满足边长与像素预算约束。
 */
function resolveResolution(
    rawSize: string | undefined,
    aspectRatio: string | undefined,
): string | undefined {
    let ratio: number | null = null;
    if (rawSize) ratio = ratioFromSize(rawSize);
    if (ratio == null && aspectRatio) ratio = ratioFromAspect(aspectRatio);
    if (ratio == null) return undefined;
    return snapToSizeList(ratio);
}

// ── HTTP(带瞬态重试)────────────────────────────────────────────

async function postJsonOnce(
    url: string,
    apiKey: string,
    body: unknown,
    timeoutMs: number,
    signal?: AbortSignal,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
): Promise<any> {
    const sig = withTimeout(signal, timeoutMs);
    const res = await fetch(url, {
        method: 'POST',
        headers: {
            Authorization: `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
        signal: sig,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
        const msg = data?.message ?? data?.error?.message ?? res.statusText;
        throw makeHttpError(`[tencent-image] 请求失败: ${res.status} ${msg}`, res.status);
    }
    return data;
}

async function postJson(
    url: string,
    apiKey: string,
    body: unknown,
    timeoutMs: number,
    signal?: AbortSignal,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
): Promise<any> {
    let lastErr: unknown;
    for (let attempt = 0; attempt <= TRANSIENT_RETRIES; attempt++) {
        try {
            return await postJsonOnce(url, apiKey, body, timeoutMs, signal);
        } catch (e) {
            lastErr = e;
            if (signal?.aborted) throw e;
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const status = (e as any)?.statusCode as number | undefined;
            const transient = status == null || isTransientStatus(status);
            if (!transient) throw e;
            if (attempt >= TRANSIENT_RETRIES) break;
            const delay = TRANSIENT_BACKOFF_MS * (attempt + 1);
            Logger.warn(
                `[tencent-image] ${status == null ? '网络超时' : `HTTP ${status}`}(尝试 ${attempt + 1}/${TRANSIENT_RETRIES + 1}),${delay}ms 后重试`,
            );
            await sleep(delay, signal);
        }
    }
    throw lastErr;
}

function collectProviderParams(
    providerOptions: ImageModelV4CallOptions['providerOptions'],
    provider: Provider,
): Record<string, unknown> {
    const merged: Record<string, unknown> = {};
    if (providerOptions) {
        for (const key of [provider.id, 'tencent', 'hunyuan', 'tokenhub']) {
            const v = providerOptions[key];
            if (v && typeof v === 'object') Object.assign(merged, v);
        }
    }
    return merged;
}

/**
 * 从 submit / query 的返回里提取任务级失败信息;非失败返回 null。
 * 混元 3.0 的 submit 可能"HTTP 200 但 status=failed",需在业务层识别。
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function extractJobError(data: any): string | null {
    const status = String(data?.status ?? '').toLowerCase();
    if (status === 'failed' || status === 'error' || status === 'canceled') {
        return data?.error?.message ?? data?.message ?? status;
    }
    return null;
}

async function pollJob(args: {
    origin: string;
    apiKey: string;
    modelId: string;
    id: string;
    signal?: AbortSignal;
}): Promise<string[]> {
    const { origin, apiKey, modelId, id, signal } = args;
    const deadline = Date.now() + MAX_POLL_MS;

    for (; ;) {
        if (signal?.aborted) throw abortError();

        const data = await postJson(
            `${origin}${QUERY_PATH}`,
            apiKey,
            { model: modelId, id },
            QUERY_TIMEOUT_MS,
            signal,
        );

        const status: string = String(data?.status ?? '').toLowerCase();

        if (status === 'completed' || status === 'succeeded' || status === 'success') {
            const urls = parseResultUrls(data);
            if (urls.length === 0) {
                throw new Error(
                    `[tencent-image] 任务完成但未返回图片 URL: ${JSON.stringify(data)}`,
                );
            }
            return urls;
        }

        const jobErr = extractJobError(data);
        if (jobErr != null) {
            throw new Error(`[tencent-image] 生图任务失败: ${jobErr}`);
        }

        if (Date.now() > deadline) {
            throw new Error(`[tencent-image] 生图任务轮询超时 (${MAX_POLL_MS}ms)`);
        }
        await sleep(POLL_INTERVAL_MS, signal);
    }
}

function createTencentImageModel(
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
                throwPrecondition('[tencent-image] 混元生图需要提供 prompt');
            }

            const extra = collectProviderParams(options.providerOptions, provider);

            // resolution:providerOptions.resolution 优先取比例,否则 size / aspectRatio;
            // 一律 snap 到官方尺寸列表(满足边长与像素预算约束)。
            const rawSize =
                (typeof extra.resolution === 'string' ? extra.resolution : undefined) ??
                options.size;
            const resolution = resolveResolution(rawSize, options.aspectRatio);
            // extra 里可能带了非法 resolution,交给 resolveResolution 归一后覆盖,防止漏发原值。
            delete extra.resolution;

            const imageRefs = collectImageRefs(options.files);
            const hasRefs = imageRefs.length > 0;

            if (options.mask) {
                warnings.push({
                    type: 'unsupported',
                    feature: 'mask',
                    details: '混元生图暂不支持 mask,已忽略',
                });
            }
            if (options.aspectRatio && options.size) {
                warnings.push({
                    type: 'compatibility',
                    feature: 'aspectRatio',
                    details: '已按显式 size 输出,忽略 aspectRatio',
                });
            }

            const useLite = !hasRefs && /lite/i.test(modelId);

            const baseBody: Record<string, unknown> = {
                ...extra,
                model: modelId,
                prompt: options.prompt,
            };
            if (resolution) baseBody.resolution = resolution;
            if (options.seed != null && baseBody.seed == null) {
                baseBody.seed = options.seed;
            }

            Logger.debug(
                `[tencent-image] 原生调用 ${provider.id}::${modelId} ` +
                `mode=${useLite ? 'lite-sync' : 'v3-async'} refs=${imageRefs.length} ` +
                `入参 size=${options.size ?? '-'} aspectRatio=${options.aspectRatio ?? '-'} ` +
                `→ resolution=${resolution ?? '-'}`,
            );

            let urls: string[];

            if (useLite) {
                const data = await postJson(
                    `${origin}${LITE_PATH}`,
                    apiKey,
                    { ...baseBody, rsp_img_type: 'url' },
                    SUBMIT_TIMEOUT_MS,
                    options.abortSignal,
                );
                const jobErr = extractJobError(data);
                if (jobErr != null) {
                    throw new Error(`[tencent-image] lite 生图失败: ${jobErr}`);
                }
                urls = parseResultUrls(data);
                if (urls.length === 0) {
                    throw new Error(
                        `[tencent-image] lite 未返回图片 URL: ${JSON.stringify(data)}`,
                    );
                }
            } else {
                const submitBody: Record<string, unknown> = { ...baseBody };
                if (hasRefs) submitBody.images = imageRefs;

                const submitted = await postJson(
                    `${origin}${SUBMIT_PATH}`,
                    apiKey,
                    submitBody,
                    SUBMIT_TIMEOUT_MS,
                    options.abortSignal,
                );

                // submit 可能 HTTP 200 但 status=failed(如参数错误),先识别再取图。
                const submitErr = extractJobError(submitted);
                if (submitErr != null) {
                    throw new Error(`[tencent-image] 提交任务失败: ${submitErr}`);
                }

                const immediate = parseResultUrls(submitted);
                if (immediate.length > 0) {
                    urls = immediate;
                } else {
                    const id = submitted?.id;
                    if (!id) {
                        throw new Error(
                            `[tencent-image] 提交任务未返回 id: ${JSON.stringify(submitted)}`,
                        );
                    }
                    urls = await pollJob({
                        origin,
                        apiKey,
                        modelId,
                        id,
                        signal: options.abortSignal,
                    });
                }
            }

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

export const tencentImageAdapter: ImageAdapterEntry = {
    match: (host) => isTencentHost(host),
    create: createTencentImageModel,
};