import { configService } from '$libs/store/index.js';
import { throwPrecondition } from '$libs/utils/err.js';
import { appLife } from '$libs/utils/tapable/applife.js';
import { EmbedManyResult, EmbedResult } from 'ai';
import Logger from 'electron-log/main.js';
import type { Llama, LlamaEmbeddingContext, LlamaModel } from 'node-llama-cpp';
import { getLlama } from 'node-llama-cpp';
import pMap from 'p-map';
import { EmbedingImpl, EmbedingOptions } from '../type.js';

class LocalEmbeding {
    embeddingModel: LlamaModel | null = null;
    llamaInstance: Llama | null = null;
    embeddingContext: LlamaEmbeddingContext | null = null;
    private unregisterBeforeQuit: (() => void) | null = null;

    constructor() {
        this.unregisterBeforeQuit = appLife.beforeQuit.tapPromise('LocalEmbeding', async () => {
            Logger.debug('[LocalEmbeding] 正在清理资源...');
            await this.dispose();
            Logger.debug('[LocalEmbeding] 清理资源完成。');
        });
    }

    dispose(): void {
        this.unregisterBeforeQuit?.();
        this.unregisterBeforeQuit = null;
        // ... 其余 dispose 逻辑不变
    }

    async disposeImpl() {
        if (this.embeddingContext) {
            try {
                if (!this.embeddingContext.disposed) {
                    await this.embeddingContext.dispose();
                    Logger.info('本地嵌入上下文已成功从显存/内存中销毁');
                }
            } catch (error) {
                Logger.error('销毁本地模型的上下文时出错:', error);
            } finally {
                this.embeddingContext = null;
            }
        }
        if (this.embeddingModel) {
            try {
                if (!this.embeddingModel.disposed) {
                    await this.embeddingModel.dispose();
                    Logger.info('本地模型及关联上下文已成功从显存/内存中销毁');
                }
            } catch (error) {
                Logger.error('销毁本地模型时出错:', error);
            } finally {
                this.embeddingModel = null;
            }
        }
    }

    private async embed(value: string, _opts?: EmbedingOptions): Promise<EmbedResult> {
        if (!this.embeddingContext) {
            throwPrecondition("本地嵌入引擎未能正确初始化。")
        }
        const embedding = await this.embeddingContext.getEmbeddingFor(value);
        return {
            value,
            embedding: [...embedding.vector],
            usage: { tokens: 0 },
            warnings: []
        }
    }

    private async embedMany(values: string[], _opts?: EmbedingOptions): Promise<EmbedManyResult> {
        if (!this.embeddingContext) {
            throwPrecondition("本地嵌入引擎未能正确初始化。")
        }
        const embeddingObjects = await pMap(
            values,
            async (text) => this.embeddingContext!.getEmbeddingFor(text),
            { concurrency: configService().get("concurrency") }
        )
        return {
            values,
            embeddings: embeddingObjects.map(item => [...item.vector]),
            usage: { tokens: 0 },
            warnings: []
        }
    }

    async init(modelPath: string): Promise<EmbedingImpl> {
        await this.disposeImpl();
        if (!this.llamaInstance) {
            this.llamaInstance = await getLlama();
        }
        Logger.debug("load model=", modelPath)
        this.embeddingModel = await this.llamaInstance.loadModel({ modelPath });

        this.embeddingContext = await this.embeddingModel.createEmbeddingContext({
            contextSize: 'auto',
        });
        return {
            embed: this.embed.bind(this),
            embedMany: this.embedMany.bind(this)
        }
    }
}

export const localEmbeding = new LocalEmbeding();