// nodes/plan-video-segments/index.ts
import { checkExpiry } from "$libs/blueprint/glossary/expiry.js";
import { getSmartModel } from "$libs/model/balancer/get-smart-model.js";
import type { IRunnerContext } from "$types/blueprint/context.js";
import { generateText } from "ai";
import pMap from "p-map";
import { SEGMENT_PLANNER_PROMPT } from "./prompts/segment-planner.js";
import { VideoSegmentStorage } from "./storage.js";
import type { SegmentDialogue, SegmentShot, VideoSegment } from "./types.js";

const P = "#video:";
const SEGMENT_DURATION_BUDGET = 15;
const DEFAULT_SHOT_SECONDS = 3;
const SEGMENT_PROMPT_BUDGET_CHARS = 4000;

interface ParsedShot {
    shot_index: number;
    text: string;
    shot_type: string;
    camera_movement: string;
    duration_seconds: number;
    raw_header: string;
    locked_dialogues: LockedDialogue[];
    is_silent: boolean;
    /** 本镜引用的实体全局名集合（用于查 entity_asset） */
    referenced_entities: string[];
}

interface LockedDialogue {
    beat_index: number;
    speaker: string;
    line: string;
    position_in_beat: number;
}

interface ChunkCache {
    shots: ParsedShot[];
    segments: Array<{ shots: ParsedShot[]; startSeconds: number }>;
    globalStyle: { style: string; color_tone: string; aspect_ratio: string };
    /** 全场所有 ref 图（按参考图全局顺序，含 env / 角色 / 制服 / 群体） */
    refImagesByShotIdx: Map<number, Array<{ ref_id: string; entity_name: string; role: string }>>;
    /** 静态陈设名集合（已在环境图中，跳过内联描述） */
    staticSetNames: Set<string>;
    /** 上游已就绪数据：本场 scene_id → 数据 */
    sceneData: {
        lighting: string;
        intent: string;
        environmentPrompt: string;
        /** scene_id → entity_name → 素材描述拼接 */
        assetByEntity: Map<string, string>;
    };
}

export async function planVideoSegments(ctx: IRunnerContext): Promise<void> {
    const store = new VideoSegmentStorage(ctx);
    const sceneIds = store.sceneIds();
    if (!sceneIds.length) {
        ctx.info("[planVideoSegments] 无场景，跳过");
        return;
    }
    await pMap(sceneIds, sid => planSceneSegments(ctx, sid), { concurrency: 2 });
    ctx.info(`[planVideoSegments] 完成，共 ${sceneIds.length} 个场景`);
}

async function planSceneSegments(ctx: IRunnerContext, sceneId: string): Promise<void> {
    const store = new VideoSegmentStorage(ctx);
    const cache = buildChunkCache(ctx, store, sceneId);
    if (!cache) return;

    const refImgKeys = collectRefImgKeysForScene(ctx, store, sceneId, cache.shots);
    const inputKeys = [
        `${P}parse:idx:scenes`,
        `${P}shots:design_${sceneId}`,
        `${P}shots:lighting_${sceneId}`,
        `${P}shots:intent_${sceneId}`,
        `${P}state:beat_nl_${sceneId}`,
        `${P}refimg:env_${sceneId}`,
        "config:style",
        "config:colorTone",
        "config:aspectRatio",
        ...refImgKeys,
        ...store.getShotPrompts(sceneId).map(s => `${P}refimg:shot_${sceneId}_${s.shot_index}`),
        // entity_asset 也作为 gate input（素材描述变化时重算）
        ...cache.sceneData.assetByEntity.size > 0
            ? Array.from(cache.sceneData.assetByEntity.keys()).map(name => `${P}shots:asset_${sceneId}_${name}`)
            : [],
    ];

    const existing = store.getAllSegments(sceneId);
    const outputKeys = existing.length > 0
        ? existing.map(s => store.segmentKey(sceneId, parseInt(s.segment_id.split("_")[1] ?? "0", 10)))
        : [`${P}video:idx:segments_${sceneId}`];

    if (!checkExpiry(ctx, { inputKeys, outputKeys })) {
        ctx.info(`[planSceneSegments] ${sceneId} video segments 仍新鲜，跳过`);
        return;
    }

    const finalSegments = await pMap(
        cache.segments,
        async (segSpec, i) => buildSegment(ctx, store, sceneId, segSpec, i, cache),
        { concurrency: 3 },
    );

    store.saveAllSegments(sceneId, finalSegments);
    ctx.info(`[planSceneSegments] ${sceneId} 完成 ${finalSegments.length} 个 segment`);
}

function buildChunkCache(
    ctx: IRunnerContext,
    store: VideoSegmentStorage,
    sceneId: string,
): ChunkCache | null {
    const design = store.getShotDesign(sceneId);
    if (!design) {
        ctx.warn(`[planSceneSegments] ${sceneId} 缺少分镜设计，跳过`);
        return null;
    }

    const beatNl = store.getBeatNl(sceneId);
    const shots = parseShots(design, beatNl);
    if (shots.length === 0) {
        ctx.warn(`[planSceneSegments] ${sceneId} 未解析出镜头`);
        return null;
    }

    const segments = packShotsIntoSegments(shots);
    const globalStyle = store.getGlobalStyle();
    const staticSetNames = collectStaticSetNames(ctx, store, sceneId);

    // ===== 收集 ref 图（含环境/角色/制服/群体，按场景内已生成顺序）=====
    const refImagesByShotIdx = new Map<number, Array<{ ref_id: string; entity_name: string; role: string }>>();
    for (const shot of shots) {
        const refs = collectRefsForShot(ctx, store, sceneId, shot, staticSetNames);
        refImagesByShotIdx.set(shot.shot_index, refs);
    }

    // ===== 喂入上游已就绪数据 =====
    const lighting = store.getLightingNL(sceneId) ?? "（无场景光照数据）";
    const intent = store.getIntent(sceneId) ?? "（无场景意图数据）";
    const environmentPrompt = store.getSceneEnvironmentPrompt(sceneId) ?? "（无环境图 prompt）";

    const assetByEntity = new Map<string, string>();
    for (const e of readStageEntities(ctx, store, sceneId)) {
        const asset = store.getEntityAsset(sceneId, e.name);
        if (!asset) continue;
        const lines = [`# ${e.name}（${e.kind}）`];
        if (asset.base_description) lines.push(`基础描述：${asset.base_description}`);
        if (asset.scene_delta) lines.push(`本场变化：${asset.scene_delta}`);
        if (asset.lighting_effect) lines.push(`光影效果：${asset.lighting_effect}`);
        assetByEntity.set(e.name, lines.join("\n"));
    }

    return {
        shots,
        segments,
        globalStyle,
        refImagesByShotIdx,
        staticSetNames,
        sceneData: { lighting, intent, environmentPrompt, assetByEntity },
    };
}

/**
 * 收集本镜需要的全部 ref 图：
 * - env（场景环境图）
 * - 该镜引用的角色 refsheet（含 source_group individual 提升个体）
 * - 该镜引用的群体制服（如有）
 * - 静态陈设不收（已在环境图中）
 */
function collectRefsForShot(
    _ctx: IRunnerContext,
    store: VideoSegmentStorage,
    sceneId: string,
    shot: ParsedShot,
    staticSetNames: Set<string>,
): Array<{ ref_id: string; entity_name: string; role: string }> {
    const refs: Array<{ ref_id: string; entity_name: string; role: string }> = [];

    // 环境图总是 ref
    refs.push({
        ref_id: `env:${sceneId}`,
        entity_name: "场景环境",
        role: "environment_reference（保持空间布局与光影基调）",
    });

    const decisions = store.getSceneDecisions(sceneId);
    const decisionByName = new Map(decisions.map(d => [d.name, d]));

    for (const localName of shot.referenced_entities) {
        const globalName = store.resolveToGlobalName(sceneId, localName);
        const entity = store.getGlobalEntity(globalName);
        if (!entity) continue;

        // 静态陈设已在环境图，跳过
        if (entity.kind === "set" && staticSetNames.has(globalName)) continue;

        // 光源不渲染
        if (entity.kind === "light") continue;

        const decision = decisionByName.get(globalName);

        if (decision?.strategy === "individual_refsheet") {
            refs.push({
                ref_id: `${sceneId}__${globalName}`,
                entity_name: globalName,
                role: entity.kind === "character"
                    ? "face_and_appearance_reference（保持人物外观严格一致）"
                    : "prop_reference（保持道具/陈设外观）",
            });
        } else if (decision?.strategy === "uniform_refsheet" && decision.uniform_name) {
            refs.push({
                ref_id: `uniform:${decision.uniform_name}`,
                entity_name: decision.uniform_name,
                role: "costume_reference（参考制服款式，群体成员统一着装）",
            });
        } else if (decision?.strategy === "group_photo") {
            refs.push({
                ref_id: `${sceneId}__${globalName}`,
                entity_name: globalName,
                role: "group_reference（参考群体整体视觉风格与人数）",
            });
        }
        // prompt_only / skip → 不收 ref（由 entity_asset 内联描述承载）
    }

    return refs;
}

async function buildSegment(
    ctx: IRunnerContext,
    store: VideoSegmentStorage,
    sceneId: string,
    segSpec: { shots: ParsedShot[]; startSeconds: number },
    segIdx: number,
    cache: ChunkCache,
): Promise<VideoSegment> {
    const segShots = segSpec.shots;

    // ref 图：本段所有镜头 ref 的并集
    const refImagesMap = new Map<string, { ref_id: string; entity_name: string; role: string }>();
    for (const s of segShots) {
        for (const r of cache.refImagesByShotIdx.get(s.shot_index) ?? []) {
            refImagesMap.set(r.ref_id, r);
        }
    }
    const refImagesStructured = Array.from(refImagesMap.values());

    // 锁源对白：本段所有镜头对白合并
    const lockedDialogues: LockedDialogue[] = [];
    for (const s of segShots) {
        for (const ld of s.locked_dialogues) {
            lockedDialogues.push(ld);
        }
    }

    // 实体素材：本段出现的实体（去重）
    const entitiesInSegment = new Set<string>();
    for (const s of segShots) {
        for (const e of s.referenced_entities) {
            const globalName = store.resolveToGlobalName(sceneId, e);
            if (cache.sceneData.assetByEntity.has(globalName)) {
                entitiesInSegment.add(globalName);
            }
        }
    }
    const entityAssetsSection = entitiesInSegment.size > 0
        ? Array.from(entitiesInSegment).map(name => cache.sceneData.assetByEntity.get(name)!).join("\n\n")
        : "（本段无 prompt_only 实体，所有实体已由参考图承载）";

    const previousEndState = segIdx === 0 ? "" : "";

    const referenceImageList = formatReferenceImageListForPrompt(refImagesStructured);
    const userPrompt = SEGMENT_PLANNER_PROMPT.user({
        sceneId,
        durationBudget: `≤${SEGMENT_DURATION_BUDGET}`,
        shotTexts: segShots.map(s => s.text).join("\n\n"),
        referenceImageList,
        sceneLighting: cache.sceneData.lighting,
        sceneIntent: cache.sceneData.intent,
        sceneEnvironmentPrompt: cache.sceneData.environmentPrompt,
        lockedDialogues: renderLockedDialogueSection(lockedDialogues),
        entityAssets: entityAssetsSection,
        previousSegmentEndState: previousEndState,
        sceneStyle: `风格：${cache.globalStyle.style}｜色调：${cache.globalStyle.color_tone}｜画幅：${cache.globalStyle.aspect_ratio}`,
    });

    const { text } = await generateText({
        model: getSmartModel(undefined, ctx),
        instructions: SEGMENT_PLANNER_PROMPT.system,
        prompt: clampToBudget(userPrompt, SEGMENT_PROMPT_BUDGET_CHARS),
    });

    const shotBreakdown = segShots.map((s, idx): SegmentShot => ({
        shot_index: s.shot_index,
        time_range: computeTimeRange(segSpec.startSeconds, segShots, idx),
        shot_type: s.shot_type,
        camera_movement: s.camera_movement,
        description: extractShotDescription(s.text),
        dialogue: buildSegmentDialogues(s.locked_dialogues, segSpec.startSeconds, segShots, idx),
        is_silent: s.is_silent,
    }));

    const totalSeconds = Math.min(
        SEGMENT_DURATION_BUDGET,
        segShots.reduce((acc, s) => acc + s.duration_seconds, 0),
    );

    return {
        segment_id: `${sceneId}_${segIdx + 1}`,
        scene_id: sceneId,
        shot_indices: segShots.map(s => s.shot_index),
        total_duration: `${totalSeconds}秒`,
        start_timestamp: "0秒",
        end_timestamp: `${totalSeconds}秒`,
        is_continuous: true,
        shot_breakdown: shotBreakdown,
        reference_images: refImagesStructured,
        prompt: text.trim(),
        has_dialogue: shotBreakdown.some(s => !s.is_silent),
    };
}

function renderLockedDialogueSection(dialogues: LockedDialogue[]): string {
    if (dialogues.length === 0) return "（本段无对白）";
    const lines: string[] = [
        `下列台词为本场景节拍原文，已按发生顺序排列。视频 prompt 中引用这些台词时必须逐字照抄，标点（含"！"「？」"等）也须保持原样。`,
        ``,
    ];
    for (const d of dialogues) {
        lines.push(`- [节拍${d.beat_index}·第${d.position_in_beat}句] ${d.speaker}："${d.line}"`);
    }
    lines.push(`对白出现时序由上文节拍序号保证；视频 prompt 中的对白必须与上述原文完全一致。`);
    return lines.join("\n");
}

function buildSegmentDialogues(
    locked: LockedDialogue[],
    segmentStartSeconds: number,
    shots: ParsedShot[],
    shotIdxInSegment: number,
): SegmentDialogue[] {
    return locked.map((d, idx): SegmentDialogue => {
        const priorShotsSeconds = shots
            .slice(0, shotIdxInSegment)
            .reduce((s, x) => s + x.duration_seconds, 0);
        const approxGlobal = segmentStartSeconds + priorShotsSeconds + d.position_in_beat * 1.5;
        return {
            sequence: idx + 1,
            speaker: d.speaker,
            tone: "原文未标注",
            line: d.line,
            timing_marker: `第${approxGlobal.toFixed(1)}秒`,
            beat_index: d.beat_index,
        };
    });
}

function collectStaticSetNames(
    _ctx: IRunnerContext,
    store: VideoSegmentStorage,
    sceneId: string,
): Set<string> {
    const out = new Set<string>();
    const decisions = store.getSceneDecisions(sceneId);
    for (const d of decisions) {
        if (d.kind === "set" && d.strategy === "prompt_only") {
            out.add(d.name);
        }
    }
    return out;
}

function readStageEntities(
    _ctx: IRunnerContext,
    store: VideoSegmentStorage,
    sceneId: string,
): Array<{ name: string; kind: string; origin?: string; appearance?: string }> {
    const stage = store.getStage(sceneId);
    if (!stage) return [];
    return stage.entities.map(e => ({
        name: e.name,
        kind: e.kind,
        origin: e.origin,
        appearance: e.appearance ?? undefined,
    }));
}

function packShotsIntoSegments(shots: ParsedShot[]): Array<{
    shots: ParsedShot[];
    startSeconds: number;
}> {
    const out: Array<{ shots: ParsedShot[]; startSeconds: number }> = [];
    let bucket: ParsedShot[] = [];
    let bucketSeconds = 0;
    let cursor = 0;

    for (const shot of shots) {
        if (bucket.length === 0) {
            bucket.push(shot);
            bucketSeconds = shot.duration_seconds;
            cursor += shot.duration_seconds;
            continue;
        }
        if (bucketSeconds + shot.duration_seconds <= SEGMENT_DURATION_BUDGET) {
            bucket.push(shot);
            bucketSeconds += shot.duration_seconds;
            cursor += shot.duration_seconds;
        } else {
            out.push({ shots: bucket, startSeconds: cursor - bucketSeconds });
            bucket = [shot];
            bucketSeconds = shot.duration_seconds;
            cursor += shot.duration_seconds;
        }
    }

    if (bucket.length > 0) {
        out.push({ shots: bucket, startSeconds: cursor - bucketSeconds });
    }

    return out;
}

function formatReferenceImageListForPrompt(
    refs: Array<{ ref_id: string; entity_name: string; role: string }>,
): string {
    return refs
        .map((r, i) => `@Image${i + 1} = ${r.entity_name}（${r.role}）`)
        .join("\n");
}

function clampToBudget(text: string, maxChars: number): string {
    if (text.length <= maxChars) return text;
    const head = text.slice(0, Math.floor(maxChars * 0.7));
    const tail = text.slice(-Math.floor(maxChars * 0.2));
    return `${head}\n\n[…为控制长度已省略冗余…]\n\n${tail}`;
}

// ============================================================
// 节拍 NL 解析 → 锁源对白
// ============================================================

const BEAT_HEADER_PATTERN = /^##\s*节拍\s*(\d+)\s*[｜|]/gm;
const DIALOGUE_LINE_IN_BEAT = /(?:^|\n)([-*]\s*)?(?<speaker>[^\n]+?)\s+(?:动作：[\s\S]*?)?台词：(?<line>[\s\S]*?)(?=\s*(?:动作：|台词：|状态变化：|情绪：|来源群体：|$|\n))/gm;

export function parseBeatDialogues(beatNl: string | null): Map<number, LockedDialogue[]> {
    const out = new Map<number, LockedDialogue[]>();
    if (!beatNl) return out;

    const beatRanges: Array<{ index: number; start: number; end: number }> = [];
    const matches = Array.from(beatNl.matchAll(BEAT_HEADER_PATTERN));
    for (let i = 0; i < matches.length; i++) {
        const m = matches[i];
        const start = m.index ?? 0;
        const end = i + 1 < matches.length ? (matches[i + 1].index ?? beatNl.length) : beatNl.length;
        const index = parseInt(m[1], 10);
        beatRanges.push({ index, start, end });
    }

    for (const range of beatRanges) {
        const beatText = beatNl.slice(range.start, range.end);
        const lockedList: LockedDialogue[] = [];
        let position = 0;
        for (const dm of beatText.matchAll(DIALOGUE_LINE_IN_BEAT)) {
            const speaker = (dm.groups?.speaker ?? "").trim();
            const line = (dm.groups?.line ?? "").trim();
            if (!line) continue;
            if (!speaker || /^无$/.test(speaker)) continue;
            position += 1;
            lockedList.push({
                beat_index: range.index,
                speaker,
                line,
                position_in_beat: position,
            });
        }
        if (lockedList.length > 0) out.set(range.index, lockedList);
    }

    return out;
}

function assignDialoguesToShots(
    shots: ParsedShot[],
    beatDialogues: Map<number, LockedDialogue[]>,
): void {
    const beatIndices = Array.from(beatDialogues.keys()).sort((a, b) => a - b);
    if (beatIndices.length === 0) {
        for (const s of shots) {
            s.locked_dialogues = [];
            s.is_silent = true;
        }
        return;
    }

    const flat: LockedDialogue[] = [];
    for (const bi of beatIndices) {
        for (const ld of beatDialogues.get(bi) ?? []) {
            flat.push(ld);
        }
    }

    if (flat.length === 0) {
        for (const s of shots) {
            s.locked_dialogues = [];
            s.is_silent = true;
        }
        return;
    }

    const n = shots.length;
    const per = Math.max(1, Math.floor(flat.length / n));
    let cursor = 0;
    for (let i = 0; i < n; i++) {
        const remaining = flat.length - cursor;
        const remainingShots = n - i;
        const take = i === n - 1
            ? remaining
            : Math.min(per, Math.max(0, remaining - remainingShots + 1));
        const slice = flat.slice(cursor, cursor + take);
        shots[i].locked_dialogues = slice;
        shots[i].is_silent = slice.length === 0;
        cursor += take;
    }
}

function parseShots(design: string, beatNl: string | null): ParsedShot[] {
    const blocks = design.split(/^###\s+镜头/m).slice(1);
    const shots: ParsedShot[] = blocks.map((block, idx): ParsedShot => {
        const text = "镜头" + block;
        const header = text.split("\n")[0] ?? "";

        // 抽取本镜引用的实体（从画面描述中的「规范名」）
        const referencedEntities = new Set<string>();
        for (const m of text.matchAll(/「([^」]+)」/g)) {
            referencedEntities.add(m[1].trim());
        }

        return {
            shot_index: idx + 1,
            text,
            raw_header: header,
            shot_type: pickField(text, "景别") || "MS",
            camera_movement: pickField(text, "运镜") || "固定",
            duration_seconds: parseDurationFromHeader(header),
            locked_dialogues: [],
            is_silent: true,
            referenced_entities: Array.from(referencedEntities),
        };
    });

    const beatDialogues = parseBeatDialogues(beatNl);
    assignDialoguesToShots(shots, beatDialogues);
    return shots;
}

function parseDurationFromHeader(header: string): number {
    const m = header.match(/约?\s*(\d+)\s*秒/);
    if (m) return parseInt(m[1], 10);
    return DEFAULT_SHOT_SECONDS;
}

function pickField(text: string, label: string): string {
    const m = text.match(new RegExp(`${label}[：:]\\s*([^\\n｜]+)`));
    return m ? m[1].trim() : "";
}

function computeTimeRange(startSeconds: number, shots: ParsedShot[], idx: number): string {
    const acc = shots.slice(0, idx).reduce((s, x) => s + x.duration_seconds, 0);
    const dur = shots[idx].duration_seconds;
    return `${acc}-${acc + dur}秒`;
}

function extractShotDescription(text: string): string {
    const m = text.match(/画面描述[：:]([\s\S]*?)(?=\n-|\n###|$)/);
    return m ? m[1].trim() : "";
}

function collectRefImgKeysForScene(
    _ctx: IRunnerContext,
    store: VideoSegmentStorage,
    sceneId: string,
    shots: ParsedShot[],
): string[] {
    const keys = new Set<string>();
    keys.add(`${P}refimg:env_${sceneId}`);
    for (const shot of shots) {
        for (const name of shot.referenced_entities) {
            const globalName = store.resolveToGlobalName(sceneId, name);
            keys.add(`${P}refimg:entity_${sceneId}_${globalName}`);
        }
    }
    return Array.from(keys);
}