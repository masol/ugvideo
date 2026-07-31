// nodes/render-images/types.ts

/**
 * 渲染结果。
 */
export interface RenderResult {
    id: string;
    file_path: string;
    rendered_at: number;
    prompt_used: string;
}