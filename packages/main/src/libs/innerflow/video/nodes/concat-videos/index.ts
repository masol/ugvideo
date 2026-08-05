// nodes/concat-videos/index.ts
import { checkExpiry } from "$libs/blueprint/glossary/expiry.js";
import { PrjDB } from "$libs/project/controllers/drizzle/index.js";
import type { IRunnerContext } from "$types/blueprint/context.js";
import { VideoSegmentStorage } from "../plan-video-segments/storage.js";
import { VideoRenderStorage } from "../render-videos/storage.js";
import { ConcatStorage } from "./storage.js";
import type { ConcatPlan, EpisodeConcat } from "./types.js";

const P = "#video:";

/**
 * 单集长度上限（秒）。来源 config:duration：
 *   unlimited | 30s | 60s | 3min | 5min | 10min | 20min | 40min | 60min
 * "unlimited" → 全部拼成一集，episodes.length === 1。
 */
function resolveEpisodeBudget(raw: string | null): number {
    if (!raw) return 180;             // 默认 3min
    const lower = raw.trim().toLowerCase();
    if (lower === "unlimited") return Number.POSITIVE_INFINITY;
    const m = lower.match(/^(\d+)\s*(s|sec|secs|second|seconds|m|min|mins|minute|minutes|h|hr|hrs|hour|hours)$/);
    if (!m) return 180;
    const n = parseInt(m[1], 10);
    const unit = m[2];
    if (unit.startsWith("s")) return n;
    if (unit.startsWith("m")) return n * 60;
    return n * 3600;
}

/**
 * 按场景顺序拼接所有 segment，产出按"单集上限"切分后的 ffmpeg 命令清单。
 * 仅打印，不真实执行合并。
 */
export async function concatVideos(ctx: IRunnerContext): Promise<void> {
    const store = new ConcatStorage(ctx);
    const segStore = new VideoSegmentStorage(ctx);
    const renderStore = new VideoRenderStorage(ctx);
    const prjdb = PrjDB.ensure(ctx.prj);

    const sceneIds = segStore.sceneIds();
    if (!sceneIds.length) {
        ctx.info("[concatVideos] 无场景，跳过");
        return;
    }

    // 把 config:duration 纳入 gate input；config 变更时自动重算
    const inputKeys: string[] = [
        "config:duration",
        ...sceneIds.flatMap(sid => {
            const idxs = segStore.getSceneSegmentIdxs(sid);
            return idxs.map(i => `${P}video:segment_${sid}_${i}`)
                .concat(`${P}video:idx:segments_${sid}`);
        }),
    ];

    if (!checkExpiry(ctx, { inputKeys, outputKeys: store.planKey() })) {
        ctx.info("[concatVideos] 拼接计划仍新鲜，跳过");
        return;
    }

    // ===== 收集全部已渲染 segment（按叙事顺序）=====
    const orderedSegments: Array<{
        segment_id: string;
        file_path: string;
        duration_seconds: number;
        scene_id: string;
    }> = [];
    const perSceneCommands: ConcatPlan["per_scene_commands"] = [];

    for (const sceneId of sceneIds) {
        const segments = segStore.getAllSegments(sceneId);
        const inputs: string[] = [];

        for (const seg of segments) {
            const result = renderStore.getRenderResult(seg.segment_id);
            if (!result) {
                ctx.warn(`[concatVideos] ${seg.segment_id} 未渲染，跳过该 segment`);
                continue;
            }
            orderedSegments.push({
                segment_id: seg.segment_id,
                file_path: result.file_path,
                duration_seconds: result.duration_seconds,
                scene_id: sceneId,
            });
            inputs.push(result.file_path);
        }

        if (inputs.length === 0) continue;
        perSceneCommands.push({
            scene_id: sceneId,
            command: buildFFmpegConcatCommand(inputs, sceneId, "mp4"),
            input_count: inputs.length,
        });
    }

    if (orderedSegments.length === 0) {
        ctx.warn("[concatVideos] 无已渲染 segment，无法生成拼接计划");
        return;
    }

    // ===== 按 config:duration 切集 =====
    const episodeBudgetSeconds = resolveEpisodeBudget(prjdb.get<string>("config:duration"));
    const episodes = splitIntoEpisodes(orderedSegments, episodeBudgetSeconds);

    // 兼容旧字段：把 episodes[0] 也填进 final_command（unlimited 时两者等价）
    const finalInputPaths = orderedSegments.map(s => s.file_path);
    const finalCommand = episodes.length === 1
        ? episodes[0].command
        : buildFFmpegConcatCommand(finalInputPaths, "final_all", "mp4");

    const plan: ConcatPlan = {
        final_command: finalCommand,
        per_scene_commands: perSceneCommands,
        input_files: orderedSegments,
        episodes,
        stats: {
            total_segments: orderedSegments.length,
            total_duration_seconds: orderedSegments.reduce((s, x) => s + x.duration_seconds, 0),
            total_scenes: perSceneCommands.length,
            total_episodes: episodes.length,
        },
        generated_at: Date.now(),
    };

    store.savePlan(plan);

    ctx.info(
        `[concatVideos] 已生成拼接计划：${plan.stats.total_segments} 段 / `
        + `${plan.stats.total_scenes} 场景 / `
        + `${plan.stats.total_duration_seconds} 秒 / `
        + `${plan.stats.total_episodes} 集（单集上限 ${episodeBudgetSeconds === Number.POSITIVE_INFINITY ? "unlimited" : `${episodeBudgetSeconds}s`}）`,
    );
    for (const ep of episodes) {
        ctx.info(`[concatVideos] 集 ${ep.episode_index}（${ep.episode_id}）：${ep.input_count} 段 / ${ep.duration_seconds} 秒 → ${ep.output_file}`);
    }
    ctx.info(`[concatVideos] （提示：本节点仅打印 ffmpeg 命令，不真实执行合并）`);
}

/**
 * 把已渲染 segment 按累计时长切分为若干集（episode）。
 * 单集累计时长超过 budget 时换下一集；保证每集总时长 ≤ budget（除最后一集）。
 */
function splitIntoEpisodes(
    segments: Array<{ segment_id: string; file_path: string; duration_seconds: number; scene_id: string }>,
    budgetSeconds: number,
): EpisodeConcat[] {
    const out: EpisodeConcat[] = [];
    let bucket: typeof segments = [];
    let bucketSeconds = 0;
    let idx = 0;

    const flush = () => {
        if (bucket.length === 0) return;
        idx++;
        const ids = bucket.map(b => b.segment_id);
        const paths = bucket.map(b => b.file_path);
        const episodeId = `episode_${String(idx).padStart(3, "0")}`;
        const outputFile = `${episodeId}.mp4`;
        out.push({
            episode_index: idx,
            episode_id: episodeId,
            output_file: outputFile,
            command: buildFFmpegConcatCommand(paths, episodeId, "mp4"),
            input_files: paths,
            segment_ids: ids,
            duration_seconds: bucketSeconds,
            input_count: bucket.length,
        });
        bucket = [];
        bucketSeconds = 0;
    };

    for (const seg of segments) {
        if (budgetSeconds === Number.POSITIVE_INFINITY) {
            bucket.push(seg);
            bucketSeconds += seg.duration_seconds;
            continue;
        }
        // 当前 bucket + 这一段会超预算则先封盘
        if (bucket.length > 0 && bucketSeconds + seg.duration_seconds > budgetSeconds) {
            flush();
        }
        bucket.push(seg);
        bucketSeconds += seg.duration_seconds;
    }
    flush();

    return out;
}

/**
 * 构建 ffmpeg concat 命令（filter_complex 模式，更稳；避免 demuxer 模式的时间戳漂移）。
 */
function buildFFmpegConcatCommand(inputPaths: string[], outputName: string, ext: string): string {
    const inputs = inputPaths.map(p => `-i "${p}"`).join(" ");
    const filterParts = inputPaths.map((_, i) => `[${i}:v:0][${i}:a:0]`).join("");
    const filter = `${filterParts}concat=n=${inputPaths.length}:v=1:a=1[outv][outa]`;
    const outputFile = `${outputName}.${ext}`;
    return [
        "ffmpeg",
        "-y",
        inputs,
        "-filter_complex",
        `"${filter}"`,
        "-map",
        '"[outv]"',
        "-map",
        '"[outa]"',
        "-c:v",
        "libx264",
        "-preset",
        "medium",
        "-crf",
        "18",
        "-c:a",
        "aac",
        "-b:a",
        "192k",
        "-movflags",
        "+faststart",
        `"${outputFile}"`,
    ].join(" ");
}