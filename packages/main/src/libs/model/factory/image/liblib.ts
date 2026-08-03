import { throwPrecondition } from '$libs/utils/err.js';
import type { Provider } from '$types/index.js';
import type {
    ImageModelV4,
    ImageModelV4CallOptions,
    ImageModelV4Result,
    SharedV4Warning,
} from '@ai-sdk/provider';
import Logger from 'electron-log/main.js';
import { Buffer } from 'node:buffer';
import { createHmac, randomBytes } from 'node:crypto';
import type { ImageAdapterEntry } from './registry.js';

/**
 * LiblibAI(哩布哩布 / ai.liblib.cloud)生图兼容适配器。
 *
 * 背景:vercel ai sdk 不认识 liblib 模型;这里绕过 SDK,直接调用
 * liblib 开放平台端点,并实现 ImageModelV4 契约。仅在 Electron main
 * (Node 环境)运行 —— HMAC-SHA1 签名走 node:crypto 静态导入。
 *
 * ── 模型路由(按 modelId 子串识别)────────────────────────────
 *   star-3                → /api/generate/webui/text2img (templateUuid: 5d7e6700...)
 *                          /api/generate/webui/img2img   (templateUuid: 07e00af4...)
 *                          (新版 liblib 已把 /text2img/ultra 路径收敛回通用 webui;
 *                           同样的功能,靠 templateUuid 区分。/text2img/ultra 现在 404。)
 *   kontext               → /api/generate/kontext/text2img + /img2img
 *   img1 / smart          → /api/generate/smart-img1/generate + /inpaint(有 mask)
 *   dream                 → /api/generate/libDream
 *   libedit(v2)           → /api/generate/libEdit | /libEditV2
 *   seedream              → /api/generate/seedreamV4
 *   qwen-image            → /api/generate/webui/text2img (Qwen 模板)
 *   comfyui               → /api/generate/comfyui/app
 *   default               → /api/generate/webui/text2img + /img2img (自定义模型)
 *
 *  query 端点分两类:
 *   - 旧 webui(star-3、qwen-image、自定义模型) → /api/generate/webui/status
 *                                        comfyui → /api/generate/comfyui/status
 *   - 新统一端点(其余) → /api/generate/status
 *
 * ── 鉴权(查询串签名)───────────────────────────────────────
 *   apiKey 格式:`AccessKey::SecretKey`。
 *   原文 = path + "&" + timestamp(ms) + "&" + nonce
 *   签名 = base64url(HMAC-SHA1(secretKey, 原文))  // 去掉尾部 = 补全
 *
 * 图片 URL 7 天有效,故下载为二进制返回,保证结果自包含。
 * 注:liblib 文档未提供"列出全部模型"接口,运行时不主动列举。
 */

const LIBLIB_DOMAIN = 'liblibai.cloud';

const SUBMIT_TIMEOUT_MS = 60_000;
const QUERY_TIMEOUT_MS = 30_000;
const DOWNLOAD_TIMEOUT_MS = 30_000;
const POLL_INTERVAL_MS = 5_000;
const MAX_POLL_MS = 5 * 60 * 1000;

const TRANSIENT_RETRIES = 2;
const TRANSIENT_BACKOFF_MS = 1_500;

const DEFAULT_MAX_IMAGES_PER_CALL = 1;

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

function isLiblibHost(host: string): boolean {
    return host === LIBLIB_DOMAIN || host.endsWith('.' + LIBLIB_DOMAIN);
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

// ── 鉴权 ────────────────────────────────────────────────

function buildSignatureArgs(
    apiKey: string,
    path: string,
): { accessKey: string; signature: string; timestamp: string; nonce: string } {
    const sep = apiKey.indexOf('::');
    if (sep <= 0 || sep >= apiKey.length - 1) {
        throwPrecondition(
            '[liblib-image] apiKey 格式应为 "AccessKey::SecretKey",'
            + '例如 "KIQM...::KppK..."',
        );
    }
    const accessKey = apiKey.slice(0, sep);
    const secretKey = apiKey.slice(sep + 2);

    const timestamp = String(Date.now());
    const nonce = randomNonce(16);
    const content = `${path}&${timestamp}&${nonce}`;
    const signature = hmacSha1Base64UrlSafe(secretKey, content);
    return { accessKey, signature, timestamp, nonce };
}

function randomNonce(len: number): string {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    const buf = randomBytes(len);
    let out = '';
    for (let i = 0; i < len; i++) out += chars[buf[i] % chars.length];
    return out;
}

function hmacSha1Base64UrlSafe(secretKey: string, content: string): string {
    const sig = createHmac('sha1', secretKey).update(content).digest('base64');
    return sig.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function buildSignedUrl(origin: string, path: string, apiKey: string): string {
    const { accessKey, signature, timestamp, nonce } = buildSignatureArgs(apiKey, path);
    return (
        `${origin}${path}?AccessKey=${encodeURIComponent(accessKey)}`
        + `&Signature=${encodeURIComponent(signature)}`
        + `&Timestamp=${encodeURIComponent(timestamp)}`
        + `&SignatureNonce=${encodeURIComponent(nonce)}`
    );
}

// ── 类型 ──────────────────────────────────────────────────

interface RoutePlan {
    submitPath: string;
    queryPath: string;
    /** 文生图 templateUuid */
    templateUuid: string;
    /** 图生图 templateUuid(若与 submitPath 同名端点但 templateUuid 不同) */
    img2imgTemplateUuid?: string;
    /** img2img 端点(若与文生图不同) */
    img2imgPath?: string;
    /** mask 端点(若与 submit 不同) */
    inpaintPath?: string;
    /** mask 端点对应的 templateUuid(若与默认不同) */
    inpaintTemplateUuid?: string;
}

function planForModel(modelId: string): RoutePlan {
    const id = modelId.toLowerCase();

    // ★ Star-3 改走通用 webui:/text2img/ultra 已 404,实测收敛到 /text2img + /img2img,
    //   靠 templateUuid 区分(t2i=5d7e6700..., i2i=07e00af4...)。
    if (id.includes('star-3') || id.includes('star3')) {
        return {
            submitPath: '/api/generate/webui/text2img',
            queryPath: '/api/generate/webui/status',
            templateUuid: '5d7e67009b344550bc1aa6ccbfa1d7f4',
            img2imgPath: '/api/generate/webui/img2img',
            img2imgTemplateUuid: '07e00af4fc464c7ab55ff906f8acf1b7',
        };
    }
    if (id.includes('kontext')) {
        return {
            submitPath: '/api/generate/kontext/text2img',
            queryPath: '/api/generate/status',
            templateUuid: 'fe9928fde1b4491c9b360dd24aa2b115',
            img2imgPath: '/api/generate/kontext/img2img',
        };
    }
    if (id.includes('img1') || id.includes('smart')) {
        return {
            submitPath: '/api/generate/smart-img1/generate',
            queryPath: '/api/generate/status',
            templateUuid: '86c58ea26e9a45bd9f562c6306c17c0f',
            inpaintPath: '/api/generate/smart-img1/inpaint',
        };
    }
    if (id.includes('seedream')) {
        return {
            submitPath: '/api/generate/seedreamV4',
            queryPath: '/api/generate/status',
            templateUuid: '0b6bad2fd350433ebb5abc7eb91f2ec9',
        };
    }
    if (id.includes('libedit') || id.includes('lib_edit')) {
        const v2 = id.includes('v2');
        return {
            submitPath: v2 ? '/api/generate/libEditV2' : '/api/generate/libEdit',
            queryPath: '/api/generate/status',
            templateUuid: v2
                ? 'c92f91c771db42e2b5dbff66e2e4f7a2'
                : 'cd3a6751086b4483ba5f0523aef53a79',
        };
    }
    if (id.includes('dream')) {
        return {
            submitPath: '/api/generate/libDream',
            queryPath: '/api/generate/status',
            templateUuid: 'aa835a39c1a14cfca47c6fc941137c51',
        };
    }
    if (id.includes('qwen')) {
        return {
            submitPath: '/api/generate/webui/text2img',
            queryPath: '/api/generate/webui/status',
            templateUuid: 'bf085132c7134622895b783b520b39ff',
            img2imgPath: '/api/generate/webui/img2img',
        };
    }
    if (id.includes('comfyui') || id.includes('workflow')) {
        return {
            submitPath: '/api/generate/comfyui/app',
            queryPath: '/api/generate/comfyui/status',
            templateUuid: '4df2efa0f18d46dc9758803e478eb51c',
        };
    }

    // 默认:LiblibAI 自定义模型 → webui text2img / img2img
    return {
        submitPath: '/api/generate/webui/text2img',
        queryPath: '/api/generate/webui/status',
        templateUuid: 'e10adc3949ba59abbe56e057f20f883e',
        img2imgPath: '/api/generate/webui/img2img',
        img2imgTemplateUuid: '9c7d531dc75f476aa833b3d452b8f7ad',
    };
}

// ── 响应解析 ──────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function extractGenerateUuid(data: any): string | null {
    const id = data?.data?.generateUuid ?? data?.generateUuid;
    if (typeof id === 'string' && id.length > 0) return id;
    return null;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function extractSyncError(data: any): string | null {
    if (data && typeof data.code === 'number' && data.code !== 0) {
        return data.msg ?? data.message ?? `code=${data.code}`;
    }
    return null;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function extractImageUrls(data: any): string[] {
    const arr = data?.data?.images ?? data?.images;
    if (!Array.isArray(arr)) return [];
    const urls: string[] = [];
    for (const it of arr) {
        if (typeof it?.imageUrl === 'string') urls.push(it.imageUrl);
    }
    return urls;
}

// ── 参考图归一化 ─────────────────────────────────────────

type FileArg = NonNullable<ImageModelV4CallOptions['files']>[number];

function uint8ToBase64(u8: Uint8Array): string {
    return Buffer.from(u8).toString('base64');
}

function toRef(file: FileArg): string | null {
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
        const r = toRef(f);
        if (r) refs.push(r);
    }
    return refs;
}

// ── HTTP(带瞬态重试)────────────────────────────────────────

async function postSignedOnce(
    origin: string,
    path: string,
    apiKey: string,
    body: unknown,
    timeoutMs: number,
    signal?: AbortSignal,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
): Promise<any> {
    const url = buildSignedUrl(origin, path, apiKey);
    const sig = withTimeout(signal, timeoutMs);
    const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: sig,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
        const msg = data?.msg ?? data?.message ?? res.statusText;
        throw makeHttpError(`[liblib-image] 请求失败: ${res.status} ${msg}`, res.status);
    }
    return data;
}

async function postSigned(
    origin: string,
    path: string,
    apiKey: string,
    body: unknown,
    timeoutMs: number,
    signal?: AbortSignal,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
): Promise<any> {
    let lastErr: unknown;
    for (let attempt = 0; attempt <= TRANSIENT_RETRIES; attempt++) {
        try {
            return await postSignedOnce(origin, path, apiKey, body, timeoutMs, signal);
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
                `[liblib-image] ${status == null ? '网络超时' : `HTTP ${status}`}(尝试 ${attempt + 1}/${TRANSIENT_RETRIES + 1}),${delay}ms 后重试`,
            );
            await sleep(delay, signal);
        }
    }
    throw lastErr;
}

async function downloadImage(
    url: string,
    signal?: AbortSignal,
): Promise<Uint8Array> {
    const sig = withTimeout(signal, DOWNLOAD_TIMEOUT_MS);
    const res = await fetch(url, { signal: sig });
    if (!res.ok) {
        throw makeHttpError(
            `[liblib-image] 下载生成图片失败: ${res.status} ${res.statusText}`,
            res.status,
        );
    }
    const buf = await res.arrayBuffer();
    return new Uint8Array(buf);
}

// ── Provider 额外参数 / 命名空间合并 ──────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function collectProviderFields(provider: any): Record<string, unknown> {
    if (!provider || typeof provider !== 'object') return {};
    const out: Record<string, unknown> = {};
    for (const key of ['extra', 'config', 'params', 'options']) {
        const v = provider[key];
        if (v && typeof v === 'object') Object.assign(out, v);
    }
    return out;
}

function collectProviderOptions(
    providerOptions: ImageModelV4CallOptions['providerOptions'],
    provider: Provider,
): Record<string, unknown> {
    if (!providerOptions) return {};
    const out: Record<string, unknown> = {};
    for (const key of [provider.id, 'liblib', 'liblibai']) {
        const v = providerOptions[key];
        if (v && typeof v === 'object') Object.assign(out, v);
    }
    return out;
}

function createLiblibImageModel(
    provider: Provider,
    modelId: string,
): ImageModelV4 {
    const apiKey = provider.apiKey ?? '';
    const origin = deriveOrigin(provider.baseUrl);
    const plan = planForModel(modelId);
    const providerExtra = collectProviderFields(provider);

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
                throwPrecondition('[liblib-image] liblib 生图需要提供 prompt');
            }

            const imageRefs = collectImageRefs(options.files);
            const maskRef = options.mask ? toRef(options.mask) : null;
            const hasMask = !!maskRef;
            const hasRefs = imageRefs.length > 0;

            // 路由:mask → inpaint;有参考图 → img2img;否则 text2img。
            let submitPath: string;
            let templateUuid: string;
            if (hasMask && plan.inpaintPath) {
                submitPath = plan.inpaintPath;
                templateUuid = plan.inpaintTemplateUuid ?? plan.templateUuid;
            } else if (hasRefs && plan.img2imgPath) {
                submitPath = plan.img2imgPath;
                templateUuid = plan.img2imgTemplateUuid ?? plan.templateUuid;
            } else {
                submitPath = plan.submitPath;
                templateUuid = plan.templateUuid;
            }

            const generateParams: Record<string, unknown> = {
                prompt: options.prompt,
            };
            if (options.seed != null) generateParams.seed = options.seed;
            if (options.n != null) generateParams.imgCount = options.n;
            if (options.size) {
                const m = options.size.match(/^\s*(\d+)\s*[xX*]\s*(\d+)\s*$/);
                if (m) {
                    generateParams.width = parseInt(m[1], 10);
                    generateParams.height = parseInt(m[2], 10);
                }
            }
            if (options.aspectRatio) generateParams.aspectRatio = options.aspectRatio;
            if (hasRefs) generateParams.image_list = imageRefs;
            if (hasMask && maskRef) {
                if (submitPath.endsWith('/smart-img1/inpaint')) {
                    generateParams.mask = maskRef;
                } else {
                    generateParams.maskImage = maskRef;
                }
            }

            const ns = collectProviderOptions(options.providerOptions, provider);
            for (const [k, v] of Object.entries(ns)) {
                if (v !== undefined) generateParams[k] = v;
            }
            for (const [k, v] of Object.entries(providerExtra)) {
                if (v !== undefined) generateParams[k] = v;
            }

            const body: Record<string, unknown> = {
                templateUuid,
                generateParams,
            };

            Logger.debug(
                `[liblib-image] 原生调用 ${provider.id}::${modelId} → ${submitPath} `
                + `tpl=${templateUuid} refs=${imageRefs.length} mask=${hasMask}`,
            );

            const submitted = await postSigned(
                origin,
                submitPath,
                apiKey,
                body,
                SUBMIT_TIMEOUT_MS,
                options.abortSignal,
            );
            const syncErr = extractSyncError(submitted);
            if (syncErr != null) {
                throw new Error(`[liblib-image] 提交失败: ${syncErr}`);
            }
            const uuid = extractGenerateUuid(submitted);
            if (!uuid) {
                throw new Error(
                    `[liblib-image] 提交未返回 generateUuid: ${JSON.stringify(submitted)}`,
                );
            }

            const urls = await pollJob({
                apiKey,
                origin,
                queryPath: plan.queryPath,
                uuid,
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

async function pollJob(args: {
    apiKey: string;
    origin: string;
    queryPath: string;
    uuid: string;
    signal?: AbortSignal;
}): Promise<string[]> {
    const { apiKey, origin, queryPath, uuid, signal } = args;
    const deadline = Date.now() + MAX_POLL_MS;

    for (;;) {
        if (signal?.aborted) throw abortError();

        const data = await postSigned(
            origin,
            queryPath,
            apiKey,
            { generateUuid: uuid },
            QUERY_TIMEOUT_MS,
            signal,
        );

        const status: number = Number(data?.data?.generateStatus ?? NaN);

        if (status === 5) {
            const urls = extractImageUrls(data);
            if (urls.length === 0) {
                throw new Error(
                    `[liblib-image] 任务成功但未返回图片 URL: ${JSON.stringify(data?.data)}`,
                );
            }
            return urls;
        }

        if (status === 6 || status === 7) {
            const msg = data?.data?.generateMsg ?? data?.msg ?? '';
            throw new Error(`[liblib-image] 任务失败 (status=${status}): ${msg}`);
        }

        if (Date.now() > deadline) {
            throw new Error(`[liblib-image] 任务轮询超时 (${MAX_POLL_MS}ms)`);
        }
        await sleep(POLL_INTERVAL_MS, signal);
    }
}

export const liblibImageAdapter: ImageAdapterEntry = {
    match: (host) => isLiblibHost(host),
    create: createLiblibImageModel,
};