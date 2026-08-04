// nodes/render-images/types.ts

/**
 * 渲染结果。
 */
export interface RenderResult {
    id: string;
    file_path: string;
    rendered_at: number;
    prompt_used: string;
    /** 本次渲染使用的 seed（复现用） */
    seed: number;
}

/**
 * Vercel AI SDK generateImage 调用参数（本节点只准备，不调用）。
 *
 * 全能参考工作流：所有任务都是跨镜头一致性参考图，统一 16:9 2K。
 *
 * - referenceImages：依赖参考图元数据，顺序与 prompt 中"图1/图2…"文案严格一致。
 *   file_path 是相对路径（imgs/xxx.jpg）；null 表示依赖尚未渲染（上游失败）。
 *   实际字节流在 callImageAPI 里按需异步读取，不持久化进 params（避免二进制膨胀）。
 * - size：固定 16:9 2K。
 */
export interface ImageGenParams {
    prompt: string;
    referenceImages: Array<{
        ref_id: string;
        entity_name: string;
        role: string;
        file_path: string | null;
    }>;
    size: string;
    seed: number;
    n: number;
}