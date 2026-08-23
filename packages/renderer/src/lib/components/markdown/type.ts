import type { Renderers } from "@humanspeak/svelte-markdown";

export type MessageVariant = "user" | "assistant" | "error";

export type MarkdownRenderers = Partial<Renderers>;
export type Message = {
    id: string;
    role: "user" | "assistant";
    content: string;
    timestamp: Date;
    /** 是否为错误消息（正交于 role，仅影响错误风格渲染） */
    isError?: boolean;
    phaseRecords?: Array<{
        id: string;
        title: string;
        detail: string;
        timestamp: Date;
    }>;
};
