// nodes/plan-video-segments/types.ts

/**
 * 一个 video segment = 一个 ≤15s 一镜到底的视频生成单元。
 *
 * 约束：
 * - 不跨越场景（scene 边界天然保护）
 * - 默认一镜到底（is_continuous=true）
 * - 单段时长 ≤ 15s；超出则拆分多段
 * - 段内连续镜头按时间戳拼接，运镜轨迹连贯
 *
 * 对白铁律：
 * - dialogue 字段中的 line 必须与节拍原文一字不差
 * - 段生成 LLM 不得改写、增删、合并对白
 */
export interface VideoSegment {
    segment_id: string;                          // "S001_1"
    scene_id: string;                            // "S001"
    shot_indices: number[];                      // 被合并的镜头序号
    total_duration: string;                      // "约12秒" / "约15秒"
    start_timestamp: string;                     // "0秒"
    end_timestamp: string;                       // "12秒"
    is_continuous: boolean;                      // 强制 true（除非未来配置覆盖）
    shot_breakdown: SegmentShot[];
    reference_images: Array<{
        ref_id: string;
        entity_name: string;
        role: string;
    }>;
    prompt: string;                              // 最终 LLM 产出（Seedance 提示词）
    has_dialogue: boolean;                       // 段内是否有对白
}

export interface SegmentShot {
    shot_index: number;
    time_range: string;                          // "0-3秒"
    shot_type: string;
    camera_movement: string;
    description: string;
    dialogue: SegmentDialogue[];                // 多角色对白按时序排列（line 一字不改自节拍原文）
    is_silent: boolean;                          // 整镜无对白
}

export interface SegmentDialogue {
    sequence: number;                            // 同一镜内的对白序号（控制不重叠）
    speaker: string;                             // 角色规范名
    tone: string;                                // "沉稳短促"
    line: string;                                // "请！"——原文台词，不可改动
    timing_marker: string;                       // "第3.2秒" 或 "镜头前2秒"
    beat_index: number;                          // 所属节拍序号（用于追溯）
}