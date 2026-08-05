// nodes/render-videos/types.ts

/**
 * 视频渲染任务输入参数。
 */
export interface VideoGenParams {
    segment_id: string;
    prompt: string;
    referenceImages: Array<{
        ref_id: string;
        entity_name: string;
        role: string;
        file_path: string | null;
    }>;
    /** 视频时长（秒）；严格 ≤ 15 */
    duration_seconds: number;
    /** 视频画幅 */
    aspect_ratio: string;
    /** 视频帧率（fps）；默认 24，由 config:frameRate 注入 */
    frame_rate: number;
    /** seed */
    seed: number;
}

export interface VideoRenderResult {
    segment_id: string;
    file_path: string;            // 相对路径 vids/<stem>.mp4
    duration_seconds: number;
    rendered_at: number;
    prompt_used: string;
    seed: number;
}