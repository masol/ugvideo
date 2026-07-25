import {
    BaseTelemetryService,
    ITelemetryDynamicConfig,
} from "./telemetry.interface.js";

import { ExportResult, ExportResultCode } from "@opentelemetry/core";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-proto";
import { NodeSDK } from "@opentelemetry/sdk-node";
import {
    BatchSpanProcessor,
    ReadableSpan,
    SpanExporter,
} from "@opentelemetry/sdk-trace-base";

import { OpenTelemetry } from "@ai-sdk/otel";
import { registerTelemetry } from "ai";
import Logger from "electron-log";
import pTimeout from "p-timeout";
import { appLife } from "../tapable/applife.js";

/**
 * ============================================================
 * 动态代理 Exporter（中间代理人模式）
 * ------------------------------------------------------------
 * - 作为唯一注册到 NodeSDK 的 Exporter，永不被替换（管道从不中断）。
 * - 内部持有真实的 OTLPTraceExporter。
 * - 每次 export 前对比配置指纹，若 URL/Headers 变更则热重载内部实例。
 * - 若端点为 null，则静默丢弃（相当于 Noop，不产生任何网络请求）。
 * ============================================================
 */
class DynamicProxyExporter implements SpanExporter {
    private activeExporter: OTLPTraceExporter | null = null;
    private memoizedFingerprint = "";

    constructor(private readonly config: ITelemetryDynamicConfig) {
        this.syncExporter();
    }

    private fingerprint(): string {
        return JSON.stringify({
            url: this.config.endpoint,
            headers: this.config.headers ?? null,
        });
    }

    private syncExporter(): void {
        const current = this.fingerprint();
        if (current === this.memoizedFingerprint) return;

        this.memoizedFingerprint = current;

        const old = this.activeExporter;
        if (old) {
            old.shutdown().catch(() => {
                /* 忽略旧实例关闭异常 */
            });
        }

        if (this.config.endpoint) {
            this.activeExporter = new OTLPTraceExporter({
                url: this.config.endpoint,
                headers: this.config.headers,
            });
            Logger.info(
                `[Telemetry] Exporter 已切换到新端点: ${this.config.endpoint}`
            );
        } else {
            this.activeExporter = null;
            Logger.info(`[Telemetry] 端点为空，已切换到 Noop（不上报）模式`);
        }
    }

    export(
        spans: ReadableSpan[],
        resultCallback: (result: ExportResult) => void
    ): void {
        this.syncExporter();

        if (!this.activeExporter) {
            resultCallback({ code: ExportResultCode.SUCCESS });
            return;
        }

        try {
            this.activeExporter.export(spans, resultCallback);
        } catch (e) {
            Logger.error("[Telemetry] Exporter export 异常:", e);
            resultCallback({
                code: ExportResultCode.FAILED,
                error: e instanceof Error ? e : new Error(String(e)),
            });
        }
    }

    async shutdown(): Promise<void> {
        if (this.activeExporter) {
            await this.activeExporter.shutdown();
            this.activeExporter = null;
        }
    }

    async forceFlush(): Promise<void> {
        /* OTLP 无 forceFlush，由 Processor 负责 */
    }
}

/**
 * ============================================================
 * 遥测服务实现类
 * ============================================================
 */
export class TelemetryService extends BaseTelemetryService {
    private sdk: NodeSDK | null = null;
    private proxyExporter: DynamicProxyExporter | null = null;
    private started = false;
    private aiTelemetryRegistered = false;

    /** 防止 shutdown 并发重入（beforeQuit 可能与手动调用竞争） */
    private shuttingDown: Promise<void> | null = null;
    private unregisterBeforeQuit: (() => void) | null = null;

    async initialize(endpoint?: string): Promise<void> {
        // 打开调试。@todo:为了方便用户接入，是否可配置？
        // diag.setLogger(new DiagConsoleLogger(), DiagLogLevel.DEBUG);

        if (this.started) {
            Logger.warn("[Telemetry] 已初始化，忽略重复 initialize 调用");
            return;
        }

        this.unregisterBeforeQuit = appLife.beforeQuit.tapPromise('TelemetryService', async () => {
            await this.shutdown();
        });

        this.dynamicConfig.endpoint = this.normalizeEndpoint(endpoint);

        this.proxyExporter = new DynamicProxyExporter(this.dynamicConfig);

        const spanProcessor = new BatchSpanProcessor(this.proxyExporter);

        this.sdk = new NodeSDK({
            spanProcessors: [spanProcessor],
        });

        this.sdk.start();
        this.started = true;

        // 必须在 sdk.start() 之后，此时全局 TracerProvider 已就绪
        this.registerAiTelemetry();

        Logger.info(
            `[Telemetry] 已初始化。当前端点: ${this.dynamicConfig.endpoint ?? "(未配置，Noop 模式)"
            }`
        );
    }

    /**
     * 注册 Vercel AI SDK 遥测整合。
     * 注册后，所有 generateText / streamText 默认自动上报
     * （走 GenAI 语义规范的 invoke_agent / chat / execute_tool spans）。
     * 全局只需注册一次。
     */
    private registerAiTelemetry(): void {
        if (this.aiTelemetryRegistered) return;
        this.aiTelemetryRegistered = true;
        registerTelemetry(
            new OpenTelemetry({
                // 可选：补充 AI SDK 特有属性（默认全关，按需开启）
                usage: true,            // token 用量细节
                providerMetadata: true, // provider 元数据
            })
        );
        Logger.info("[Telemetry] Vercel AI SDK 遥测整合已注册");
    }

    reconfigure(endpoint?: string): void {
        if (!this.started) {
            Logger.warn("[Telemetry] 尚未 initialize，reconfigure 仅记录配置");
        }

        const next = this.normalizeEndpoint(endpoint);
        const prev = this.dynamicConfig.endpoint;

        if (next === prev) {
            Logger.info("[Telemetry] 端点未变化，跳过切换");
            return;
        }

        // 🌟 只改可变对象：下一次 span 导出时 DynamicProxyExporter 自动热重载
        this.dynamicConfig.endpoint = next;

        Logger.info(
            `[Telemetry] 端点已更新: ${prev ?? "(空)"} -> ${next ?? "(空/Noop)"}`
        );
    }

    /**
     * 退出清理动作。
     * 借鉴 ProjectManager 的写法：先打日志、执行 flush + shutdown、再收尾。
     * 内部做并发防重入，保证 beforeQuit 与手动调用只执行一次真正的关闭。
     */
    async shutdown(): Promise<void> {
        if (this.shuttingDown) return this.shuttingDown;

        this.shuttingDown = this._doShutdown();
        return this.shuttingDown;
    }

    private async _doShutdown(): Promise<void> {
        if (!this.started || !this.sdk) {
            Logger.debug("[Telemetry] 未启动或已关闭，跳过清理");
            return;
        }

        Logger.debug("[Telemetry] 正在清理遥测资源（flush 剩余 Span）...");

        try {
            // pTimeout 兜底：OTel 内部 BatchSpanProcessor 在端点不通时可能 hang 30 秒
            await pTimeout(
                this.sdk.shutdown(),
                {
                    milliseconds: 2000,
                    message: "OTel shutdown 超时（端点可能不通），放弃等待。"
                }
            );
            Logger.info("[Telemetry] 剩余遥测数据已 flush，管道已关闭。");
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
        } catch (e: any) {
            if (e?.name === "TimeoutError") {
                Logger.warn("[Telemetry] shutdown 超时（2s），放弃等待。剩余数据已丢弃。");
            } else {
                Logger.error("[Telemetry] 关闭遥测管道时发生错误：", e);
            }
        } finally {
            this.sdk = null;
            this.proxyExporter = null;
            this.started = false;
            Logger.debug("[Telemetry] 清理资源完成。");
        }
    }
}

/** 全局单例，供外部直接引用 */
const KEY = Symbol.for('unigen.singleton.telemetryService');
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const telemetryService: TelemetryService = ((globalThis as any)[KEY] ??= new TelemetryService());
