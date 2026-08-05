// nodes/concat-videos/types.ts

/**
 * 单集拼接计划：按 config:duration 把全部 segment 切分成的一集。
 */
export interface EpisodeConcat {
    /** 1-based 集序号 */
    episode_index: number;
    /** 集 ID（如 episode_001） */
    episode_id: string;
    /** 输出文件名（如 episode_001.mp4） */
    output_file: string;
    /** 该集对应的 ffmpeg 命令 */
    command: string;
    /** 该集包含的 segment 文件路径（相对路径） */
    input_files: string[];
    /** 该集包含的 segment ID */
    segment_ids: string[];
    /** 该集总时长（秒） */
    duration_seconds: number;
    /** 该集包含的 segment 数 */
    input_count: number;
}

/**
 * 拼接计划：列出所有 ffmpeg concat 命令（不真实执行）。
 */
export interface ConcatPlan {
    /** 整片一次性拼接命令（兼容字段；当 episodes.length===1 时与 episodes[0].command 等价） */
    final_command: string;
    /** 每个场景各自的拼接命令（便于单场景重渲） */
    per_scene_commands: Array<{
        scene_id: string;
        command: string;
        input_count: number;
    }>;
    /** 输入文件清单（按叙事顺序） */
    input_files: Array<{
        segment_id: string;
        file_path: string;
        duration_seconds: number;
    }>;
    /** 按 config:duration 切分后的集列表 */
    episodes: EpisodeConcat[];
    /** 统计 */
    stats: {
        total_segments: number;
        total_duration_seconds: number;
        total_scenes: number;
        total_episodes: number;
    };
    generated_at: number;
}