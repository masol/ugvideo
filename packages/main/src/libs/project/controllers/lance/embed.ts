import { createEmbeding } from "$libs/model/factory/embed.js";
import type { EmbedingOp, EmbedType } from "$libs/model/factory/type.js";
import type { EmbedKVStore } from "$libs/project/type.js";
import { configService } from "$libs/store/index.js";
import { ProjectDbKeys } from "$libs/utils/db/dbkeys.js";
import { throwNotfound, throwUnprcessable } from "$libs/utils/err.js";
import type { Provider } from '$types/index.js';
import Logger from "electron-log";
import pMap from 'p-map';
import { cluster, isNumber } from "radashi";

export class LanceEmbeding {
    #embeddingSize: number = -1;
    #embed: EmbedingOp | null = null;
    #embedFrom: string = "";
    #ready: boolean = false;

    get ready(): boolean {
        return this.#ready;
    }

    get embedFrom(): string {
        return this.#embedFrom;
    }

    get embedSize(): number {
        if (!isNumber(this.#embeddingSize) || this.#embeddingSize <= 0) {
            throwUnprcessable("[LanceDB] 未配置向量支持。")
        }
        return this.#embeddingSize;
    }

    get embed(): EmbedingOp {
        if (!this.#embed) {
            throwNotfound(`lance无法获取向量服务`)
        }
        return this.#embed;
    }

    async init(prjdb: EmbedKVStore): Promise<void> {
        const curVecModelName = configService().get("embed_model");
        if (!curVecModelName) {
            const msg = "[LanceDB] 未设置向量模型，这将禁用RAG及知识消歧，降低任务准确度。";
            Logger.warn(msg)
            this.#ready = false;
            return;
        }

        try {
            const embedingFrom = prjdb.get<string>(ProjectDbKeys.embedingFrom);
            const vecModelName = embedingFrom ? "" : prjdb.get<string>(ProjectDbKeys.embedingModelName)
            const embdingSize = embedingFrom ? -1 : prjdb.get<number>(ProjectDbKeys.embedingSize)
            if (vecModelName && vecModelName !== curVecModelName) {
                prjdb.set("embeding_from", vecModelName);
            }

            const finalEmbedModelName = vecModelName || curVecModelName;

            const providers = configService().get('models');
            let providerCfg: Provider | undefined;
            let modelId: string | undefined;
            if (finalEmbedModelName?.startsWith("::")) {
                const embedModelInfo = finalEmbedModelName.split("::");
                modelId = embedModelInfo.at(-1);
                const pdId = embedModelInfo.at(-2);
                providerCfg = providers.find((p) => p.id === pdId);
                if (!providerCfg || !modelId) {
                    Logger.warn(`[LanceDB] 未设置/已删除对应的向量嵌入的提供商:${finalEmbedModelName}，RAG将不可用。`);
                    this.#ready = false;
                    return;
                }

                this.#embed = await createEmbeding(modelId, providerCfg);
            } else {
                this.#embed = await createEmbeding(finalEmbedModelName);
            }

            if (!isNumber(embdingSize) || embdingSize <= 0) {
                const vecInfo = await this.#embed.embed("x", "document");
                this.#embeddingSize = vecInfo.embedding.length
                prjdb.set(ProjectDbKeys.embedingModelName, finalEmbedModelName);
                prjdb.set(ProjectDbKeys.embedingSize, this.#embeddingSize);
            } else {
                this.#embeddingSize = embdingSize;
            }

            this.#ready = true;
            Logger.debug(`[LanceDB] 使用${finalEmbedModelName}嵌入向量，维度为${this.#embeddingSize}`)
        } catch (e) {
            Logger.warn(`[LanceDB] 嵌入初始化失败，RAG将不可用:`, e);
            this.#ready = false;
        }
    }


    async doEmbedding(batch: string[], type: EmbedType): Promise<number[][]> {
        if (!this.#ready || !this.#embed) {
            throwUnprcessable("[LanceDB] Embedding 服务未初始化，请先配置向量模型。")
        }
        const chunks = cluster(batch, 9);

        const nestedResults = await pMap(
            chunks,
            async (chunk) => {
                const result = await this.#embed!.embedMany(chunk, type);
                if (!result?.embeddings) {
                    throwUnprcessable("[LanceDB] Embedding 批处理失败.")
                }
                return result?.embeddings;
            },
            { concurrency: configService().get("concurrency") }
        );
        return nestedResults.flat();
    }
}