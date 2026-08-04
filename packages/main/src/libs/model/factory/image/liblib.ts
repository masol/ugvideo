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
 *   star-3                → /api/generate/webui/text2img /img2img (靠 templateUuid 区分)
 *   kontext               → /api/generate/kontext/text2img /img2img (aspectRatio 枚举)
 *   img1 / smart          → /api/generate/smart-img1/generate /inpaint (aspectRatio 枚举)
 *   dream                 → /api/generate/libDream (width/height)
 *   libedit(v2)           → /api/generate/libEdit | /libEditV2 (width/height)
 *   seedream              → /api/generate/seedreamV4 (width/height)
 *   qwen-image            → /api/generate/webui/text2img (Qwen 模板,width/height)
 *   comfyui               → /api/generate/comfyui/app
 *   default               → /api/generate/webui/text2img /img2img (自定义模型,width/height)
 *
 *  size 处理(本次修复)──────────────────────────────────────
 *   liblib 不同端点的 size 字段不一样:
 *     aspectRatio 枚举:kontext、smart-img1(枚举各不同);
 *     width/height   :webui、libDream、libEdit、seedream、Qwen。
 *   按 RoutePlan.sizeStyle 在 doGenerate 阶段分发:
 *     - aspectRatio 模式:从 size "WxH" 或 options.aspectRatio 取比例,snap 到该端点
 *       允许的枚举值(Kontext 9 档;IMG1 4 档);
 *     - pixels 模式:把 size "WxH" 解析为 width/height 整数;边界由各端点硬性约束负责。
 *
 *   参考图归一化(本次提示)────────────────────────────────
 *     上层 refs 形如 { url | data | image } 或 Uint8Array。若打印 refs=0 但 prompt
 *     里提到"图1",说明 toRef 没匹配到实际形态,需在 doGenerate 加一行日志打印每个
 *     file 的 typeof 与形状,确认 raw 形态。本版保留 toRef + 增强日志。
 *
 * 图片 URL 7 天有效,故下载为二进制返回,保证结果自包含。
 * 注:liblib 文档未提供"列出全部模型"接口,运行时不主动列举。
 */

const LIBLIB_DOMAIN = 'liblibai.cloud';

const SUBMIT_TIMEOUT_MS = 120_000;
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

function isLiblibHost(host: string): boolean {
    return host === LIBLIB_DOMAIN || host.endsWith('.' + LIBLIB_DOMAIN);
}

function deriveOrigin(baseUrl: string): string {
    return new URL(baseUrl.trim()).origin;
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
    return new Promise<void>((resolve, reject) => {
        if (signal?.aborted) {
            reject(new DOMException('Aborted', 'AbortError'));
            return;
        }
        const onAbort = () => {
            clearTimeout(timer);
            reject(new DOMException('Aborted', 'AbortError'));
        };
        const timer = setTimeout(() => {
            signal?.removeEventListener('abort', onAbort);
            resolve();
        }, ms);
        signal?.addEventListener('abort', onAbort, { once: true });
    });
}

function withSafeTimeout(
    parent: AbortSignal | undefined,
    ms: number,
): { signal: AbortSignal; timedOut: () => boolean; abortedByParent: () => boolean } {
    const ctrl = new AbortController();
    let byTimeout = false;
    let byParent = false;

    const onParentAbort = () => {
        byParent = true;
        ctrl.abort(parent?.reason);
    };
    const onTimeout = () => {
        byTimeout = true;
        ctrl.abort(new DOMException('Timed out waiting for response', 'TimeoutError'));
    };
    if (parent) {
        if (parent.aborted) onParentAbort();
        else parent.addEventListener('abort', onParentAbort, { once: true });
    }
    const t = setTimeout(onTimeout, ms);
    ctrl.signal.addEventListener('abort', () => clearTimeout(t), { once: true });

    return {
        signal: ctrl.signal,
        timedOut: () => byTimeout,
        abortedByParent: () => byParent,
    };
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
    const url =
        `${origin}${path}?AccessKey=${encodeURIComponent(accessKey)}`
        + `&Signature=${encodeURIComponent(signature)}`
        + `&Timestamp=${encodeURIComponent(timestamp)}`
        + `&SignatureNonce=${encodeURIComponent(nonce)}`;
    Logger.info(
        `[liblib-image] 请求 → ${origin}${path} (AccessKey=${accessKey.slice(0, 8)}…)`,
    );
    return url;
}

// ── 类型与路由 ────────────────────────────────────────────

type SizeStyle = 'pixels' | 'aspectRatio';

interface RoutePlan {
    submitPath: string;
    queryPath: string;
    templateUuid: string;
    sizeStyle: SizeStyle;
    /** sizeStyle='aspectRatio' 时允许的枚举集合(顺序与原文一致)。 */
    allowedAspectRatios?: string[];
    img2imgTemplateUuid?: string;
    img2imgPath?: string;
    inpaintPath?: string;
    inpaintTemplateUuid?: string;
}

function planForModel(modelId: string): RoutePlan {
    const id = modelId.toLowerCase();

    if (id.includes('star-3') || id.includes('star3')) {
        return {
            submitPath: '/api/generate/webui/text2img',
            queryPath: '/api/generate/webui/status',
            templateUuid: '5d7e67009b344550bc1aa6ccbfa1d7f4',
            sizeStyle: 'pixels',
            img2imgPath: '/api/generate/webui/img2img',
            img2imgTemplateUuid: '07e00af4fc464c7ab55ff906f8acf1b7',
        };
    }
    if (id.includes('kontext')) {
        return {
            submitPath: '/api/generate/kontext/text2img',
            queryPath: '/api/generate/status',
            templateUuid: 'fe9928fde1b4491c9b360dd24aa2b115',
            sizeStyle: 'aspectRatio',
            allowedAspectRatios: [
                '1:1', '2:3', '3:2', '3:4', '4:3',
                '9:16', '16:9', '9:21', '21:9',
            ],
            img2imgPath: '/api/generate/kontext/img2img',
        };
    }
    if (id.includes('img1') || id.includes('smart')) {
        return {
            submitPath: '/api/generate/smart-img1/generate',
            queryPath: '/api/generate/status',
            templateUuid: '86c58ea26e9a45bd9f562c6306c17c0f',
            sizeStyle: 'aspectRatio',
            allowedAspectRatios: ['auto', 'square', 'portrait', 'landscape'],
            inpaintPath: '/api/generate/smart-img1/inpaint',
        };
    }
    if (id.includes('seedream')) {
        return {
            submitPath: '/api/generate/seedreamV4',
            queryPath: '/api/generate/status',
            templateUuid: '0b6bad2fd350433ebb5abc7eb91f2ec9',
            sizeStyle: 'pixels',
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
            sizeStyle: 'pixels',
        };
    }
    if (id.includes('dream')) {
        return {
            submitPath: '/api/generate/libDream',
            queryPath: '/api/generate/status',
            templateUuid: 'aa835a39c1a14cfca47c6fc941137c51',
            sizeStyle: 'pixels',
        };
    }
    if (id.includes('qwen')) {
        return {
            submitPath: '/api/generate/webui/text2img',
            queryPath: '/api/generate/webui/status',
            templateUuid: 'bf085132c7134622895b783b520b39ff',
            sizeStyle: 'pixels',
            img2imgPath: '/api/generate/webui/img2img',
        };
    }
    if (id.includes('comfyui') || id.includes('workflow')) {
        return {
            submitPath: '/api/generate/comfyui/app',
            queryPath: '/api/generate/comfyui/status',
            templateUuid: '4df2efa0f18d46dc9758803e478eb51c',
            sizeStyle: 'pixels',
        };
    }

    // 默认:LiblibAI 自定义模型 → webui text2img / img2img
    return {
        submitPath: '/api/generate/webui/text2img',
        queryPath: '/api/generate/webui/status',
        templateUuid: 'e10adc3949ba59abbe56e057f20f883e',
        sizeStyle: 'pixels',
        img2imgPath: '/api/generate/webui/img2img',
        img2imgTemplateUuid: '9c7d531dc75f476aa833b3d452b8f7ad',
    };
}

// ── size 决策 ─────────────────────────────────────────────

function parseRatioFromSize(size: string): number | null {
    const m = size.match(/^\s*(\d+(?:\.\d+)?)\s*:\s*(\d+(?:\.\d+)?)\s*$/);
    if (!m) return null;
    const w = parseFloat(m[1]);
    const h = parseFloat(m[2]);
    if (!Number.isFinite(w) || !Number.isFinite(h) || w <= 0 || h <= 0) return null;
    return w / h;
}

function parsePixelSize(size: string): { w: number; h: number } | null {
    const m = size.match(/^\s*(\d+)\s*[xX*]\s*(\d+)\s*$/);
    if (!m) return null;
    const w = parseInt(m[1], 10);
    const h = parseInt(m[2], 10);
    if (!Number.isFinite(w) || !Number.isFinite(h) || w <= 0 || h <= 0) return null;
    return { w, h };
}

/** 按对数比例距离,snap 到端点允许的 aspectRatio 枚举值。 */
function snapAspectRatio(ratio: number, options: string[]): string {
    // IMG1 用语义档(square/portrait/landscape),不能纯用对数距离。
    // 它们对应的比例:sq=1.0、portrait≈0.67、landscape≈1.5。
    const SEMANTIC: Record<string, number> = {
        square: 1,
        portrait: 2 / 3,
        landscape: 3 / 2,
    };

    // 如果枚举里有 semantic 档(Kontext 没有、IMG1 有),用语义匹配;否则用对数距离。
    const hasSemantic = options.some((o) => o in SEMANTIC);
    if (hasSemantic) {
        let best = options[0];
        let bestDelta = Infinity;
        for (const opt of options) {
            const ref = SEMANTIC[opt] ?? parseRatioFromSize(opt) ?? 1;
            const d = Math.abs(Math.log(ratio) - Math.log(ref));
            if (d < bestDelta) {
                bestDelta = d;
                best = opt;
            }
        }
        return best;
    }

    let best = options[0];
    let bestDelta = Infinity;
    for (const opt of options) {
        const r = parseRatioFromSize(opt) ?? 1;
        const d = Math.abs(Math.log(ratio) - Math.log(r));
        if (d < bestDelta) {
            bestDelta = d;
            best = opt;
        }
    }
    return best;
}

/**
 * 把上游 size + options.aspectRatio 决策为本端点所需的 generateParams 字段:
 *   - pixels 模式 → width/height(整数);
 *   - aspectRatio 模式 → aspectRatio(枚举字符串,snap 不会爆)。
 * 没拿到任何比例信息则两模式都不下发。
 */
function resolveSize(
    plan: RoutePlan,
    rawSize: string | undefined,
    optionsAspect: string | undefined,
): { width?: number; height?: number; aspectRatio?: string } {
    // 1) 先尝试从 rawSize 'WxH' / 'W:H' 取比例
    let ratio: number | null = null;
    if (rawSize) {
        const px = parsePixelSize(rawSize);
        if (px) ratio = px.w / px.h;
        else ratio = parseRatioFromSize(rawSize);
    }
    // 2) 没有再 fallback 到 options.aspectRatio('W:H')
    if (ratio == null && optionsAspect) {
        ratio = parseRatioFromSize(optionsAspect);
    }

    if (plan.sizeStyle === 'pixels') {
        if (!rawSize) return {};
        const px = parsePixelSize(rawSize);
        if (!px) return {};
        return { width: px.w, height: px.h };
    }

    // aspectRatio 枚举模式
    if (!ratio) return {};
    const allowed = plan.allowedAspectRatios ?? [];
    if (allowed.length === 0) return {};
    return { aspectRatio: snapAspectRatio(ratio, allowed) };
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

function describeShape(file: FileArg): string {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const f = file as any;
    if (typeof f === 'string') return `string(len=${f.length})`;
    if (f instanceof Uint8Array) return `Uint8Array(len=${f.length})`;
    if (f && typeof f === 'object') {
        const keys = Object.keys(f);
        const sample: Record<string, unknown> = {};
        for (const k of keys) {
            const v = (f as Record<string, unknown>)[k];
            if (typeof v === 'string') sample[k] = `string(len=${v.length})`;
            else if (v instanceof Uint8Array) sample[k] = `Uint8Array(len=${v.length})`;
            else sample[k] = typeof v;
        }
        return JSON.stringify(sample);
    }
    return typeof f;
}

function collectImageRefs(
    files: ImageModelV4CallOptions['files'],
): { refs: string[]; shapes: string[] } {
    if (!files || files.length === 0) return { refs: [], shapes: [] };
    const refs: string[] = [];
    const shapes: string[] = [];
    for (const f of files) {
        const r = toRef(f);
        if (r) refs.push(r);
        shapes.push(r ? 'ok' : `SKIP[${describeShape(f)}]`);
    }
    return { refs, shapes };
}

// ── HTTP(带瞬态重试)────────────────────────────────────────

async function postSignedOnce(
    origin: string,
    path: string,
    apiKey: string,
    body: unknown,
    timeoutMs: number,
    signal: AbortSignal | undefined,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
): Promise<any> {
    const url = buildSignedUrl(origin, path, apiKey);
    const { signal: ctrlSignal, timedOut, abortedByParent } = withSafeTimeout(signal, timeoutMs);

    try {
        const res = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
            signal: ctrlSignal,
        });
        // 关键:body 读取也放进 try —— 读 body 阶段超时同样要被转换,否则原始
        // TimeoutError 会绕过重试逻辑,被上层误判为"用户取消"而终止整条 fallback。
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
            const msg = data?.msg ?? data?.message ?? res.statusText;
            throw makeHttpError(`[liblib-image] 请求失败: ${res.status} ${msg}`, res.status);
        }
        return data;
    } catch (e) {
        // 调用方主动取消 → 原样抛(尊重用户意图,不重试)
        if (abortedByParent()) throw e;
        // 我们自己的超时(无论卡在 fetch 还是 body 读取)→ 转成 504,命中瞬态重试
        if (timedOut()) {
            throw makeHttpError(
                `[liblib-image] 请求超时(${timeoutMs}ms):${origin}${path}`,
                504,
            );
        }
        throw e;
    }
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
                `[liblib-image] ${status == null ? '网络错误' : `HTTP ${status}`}(尝试 ${attempt + 1}/${TRANSIENT_RETRIES + 1}),${delay}ms 后重试`,
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
    const { signal: ctrlSignal } = withSafeTimeout(signal, DOWNLOAD_TIMEOUT_MS);
    const res = await fetch(url, { signal: ctrlSignal });
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

            const { refs: imageRefs, shapes: refShapes } = collectImageRefs(options.files);
            const maskRef = options.mask ? toRef(options.mask) : null;
            const hasMask = !!maskRef;
            const hasRefs = imageRefs.length > 0;

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

            // size:按 plan.sizeStyle 分发(pixels vs aspectRatio enum)
            const sizeFields = resolveSize(plan, options.size, options.aspectRatio);
            Object.assign(generateParams, sizeFields);

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
                + `tpl=${templateUuid} sizeStyle=${plan.sizeStyle} `
                + `sizeFields=${JSON.stringify(sizeFields)} `
                + `refs=${imageRefs.length}/${refShapes.length} (shapes=${refShapes.join('|')}) `
                + `mask=${hasMask}`,
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

    for (; ;) {
        if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');

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