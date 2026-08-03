import { JSONObject } from "@ai-sdk/provider";
import { EmbedManyResult, EmbedResult } from "ai";

export type EmbedType = 'query' | 'document';

export type EmbedingOptions = {
    providerOptions?: Record<string, JSONObject>,
    maxRetries?: number,
    abortSignal?: AbortSignal,
    headers?: Record<string, string>
}

export interface EmbedingOp {
    embed: (value: string, type: EmbedType, opts?: EmbedingOptions) => Promise<EmbedResult>;
    embedMany: (values: string[], type: EmbedType, opts?: EmbedingOptions) => Promise<EmbedManyResult>;
}

export interface EmbedingImpl {
    embed: (value: string, opts?: EmbedingOptions) => Promise<EmbedResult>;
    embedMany: (values: string[], opts?: EmbedingOptions) => Promise<EmbedManyResult>;
}