// parse-script/types.ts

export interface PersistedScene {
    scene_id: string;
    title: string;
    line_start: number;
    line_end: number;           // 初始 -1，后处理回填
    transition_from_prev?: string;
    context: SceneContext;
}

export interface SceneContext {
    episode?: string;
    act?: string;
    location?: string;
    timeOfDay?: string;
    charactersInvolved: string[];
    first_line_summary?: string;
}

/**
 * 格式描述（从 LLM 自然语言中提取）
 * 存储后供后续 chunk 作为"推荐格式"传入
 */
export interface ScriptFormat {
    description: string;
    scene_marker_patterns: string[];
    episode_act_patterns: string[];
    transition_patterns: string[];
    synopsis_location: "header" | "synopsis_section" | "none";
    cast_location: "header" | "cast_section" | "inline" | "none";
}

/**
 * 全局信息条目（梗概、人物表等，跨 chunk 累积）
 */
export interface GlobalItem {
    kind: string;// synopsis / cast / title_page / preface / note / ...
    line_start: number;
    line_end: number;
    summary: string;
}

/**
 * chunk 切分单元
 */
export interface Chunk {
    chunk_id: string;
    line_start: number;
    line_end: number;
    window_before: number;
    window_after: number;
}

/**
 * chunk-processor 的单次 LLM 输出
 */
export interface ChunkProcessResult {
    /** null = 格式未变，不用更新 */
    format_update: ScriptFormat | null;
    global_items: GlobalItem[];
    scenes: Array<{
        line_no: number;
        title_guess: string;
        marker_text: string;
    }>;
    episode_act_markers: Array<{
        line_no: number;
        kind: "episode" | "act";
        text: string;
    }>;
}