// nodes/plan-video-segments/storage.ts
import { PrjDB } from "$libs/project/controllers/drizzle/index.js";
import type { IRunnerContext } from "$types/blueprint/context.js";
import { isDeepStrictEqual } from "node:util";
import type { GlobalEntity, SceneStage } from "../align-entities/types.js";
import type { EntityRenderDecision } from "../design-characters/types.js";
import type { EntityAsset, SceneLighting } from "../design-shots/types.js";
import type { EntityRefsheetPrompt, SceneEnvironmentPrompt, SceneShotPrompt } from "../generate-reference-images/types.js";
import type { VideoSegment } from "./types.js";

const P = "#video:";

export class VideoSegmentStorage {
    private prjdb: ReturnType<typeof PrjDB.ensure>;

    constructor(ctx: IRunnerContext) {
        this.prjdb = PrjDB.ensure(ctx.prj);
    }

    private read<T>(key: string): T | null {
        return this.prjdb.get<T>(key) ?? null;
    }

    private write<T>(key: string, value: T): void {
        const normalized = JSON.parse(JSON.stringify(value)) as T;
        const existing = this.prjdb.get<T>(key);
        if (isDeepStrictEqual(existing, normalized)) return;
        this.prjdb.set(key, normalized);
    }

    // ===== 上游只读 =====

    sceneIds(): string[] {
        return this.read<string[]>(`${P}parse:idx:scenes`) ?? [];
    }

    getShotDesign(sceneId: string): string | null {
        return this.read<string>(`${P}shots:design_${sceneId}`);
    }

    getStage(sceneId: string): SceneStage | null {
        return this.read<SceneStage>(`${P}state:stage_${sceneId}`);
    }

    getGlobalStyle(): { style: string; color_tone: string; aspect_ratio: string } {
        return {
            style: this.read<string>("config:style") ?? "cinematic",
            color_tone: this.read<string>("config:colorTone") ?? "neutral",
            aspect_ratio: this.read<string>("config:aspectRatio") ?? "9:16",
        };
    }

    getShotPrompts(sceneId: string): SceneShotPrompt[] {
        const idx = this.read<number[]>(`${P}refimg:idx:shots_${sceneId}`) ?? [];
        return idx
            .map(i => this.read<SceneShotPrompt>(`${P}refimg:shot_${sceneId}_${i}`))
            .filter((v): v is SceneShotPrompt => v != null);
    }

    getStageAlign(sceneId: string): Record<string, string> | null {
        return this.read<Record<string, string>>(`${P}stage:align:${sceneId}`);
    }

    resolveToGlobalName(sceneId: string, localName: string): string {
        const mapping = this.getStageAlign(sceneId);
        if (!mapping) return localName;
        return mapping[localName] ?? localName;
    }

    getEntityAsset(sceneId: string, entityName: string): EntityAsset | null {
        return this.read<EntityAsset>(`${P}shots:asset_${sceneId}_${entityName}`);
    }

    getGlobalEntity(name: string): GlobalEntity | null {
        return this.read<GlobalEntity>(`${P}stage:registry:${name}`);
    }

    getEntityRefsheet(sceneId: string, entityName: string): EntityRefsheetPrompt | null {
        return this.read<EntityRefsheetPrompt>(`${P}refimg:entity_${sceneId}_${entityName}`);
    }

    getBeatNl(sceneId: string): string | null {
        return this.read<string>(`${P}state:beat_nl_${sceneId}`);
    }

    /**
     * 结构化光照 → prompt 用自然语言（含全部 5 字段）
     */
    getLightingNL(sceneId: string): string | null {
        const l = this.read<SceneLighting>(`${P}shots:lighting_${sceneId}`);
        if (!l) return null;
        return [
            `主光方向：${l.key_light_direction}`,
            `主光色温：${l.key_light_color}`,
            `补光：${l.fill_light}`,
            `环境氛围：${l.ambient}`,
            `整体效果：${l.summary}`,
        ].join("\n");
    }

    /** 场景意图（含情绪基调抽取来源） */
    getIntent(sceneId: string): string | null {
        return this.read<string>(`${P}shots:intent_${sceneId}`);
    }

    /** 环境图 prompt（refimg:env_* 的 prompt 字段） */
    getSceneEnvironmentPrompt(sceneId: string): string | null {
        const env = this.read<SceneEnvironmentPrompt>(`${P}refimg:env_${sceneId}`);
        return env?.prompt ?? null;
    }

    private sceneDecisionIdxKey(sceneId: string): string {
        return `${P}char:idx:scene_decisions_${sceneId}`;
    }

    getSceneDecisions(sceneId: string): EntityRenderDecision[] {
        const names = this.read<string[]>(this.sceneDecisionIdxKey(sceneId)) ?? [];
        return names
            .map(n => this.read<EntityRenderDecision>(`${P}char:render_decision_${sceneId}_${n}`))
            .filter((v): v is EntityRenderDecision => v != null);
    }

    // ===== segment 写入 =====

    segmentKey(sceneId: string, segmentIdx: number): string {
        return `${P}video:segment_${sceneId}_${segmentIdx}`;
    }

    segmentIdxKey(sceneId: string): string {
        return `${P}video:idx:segments_${sceneId}`;
    }

    getSegment(sceneId: string, segmentIdx: number): VideoSegment | null {
        return this.read<VideoSegment>(this.segmentKey(sceneId, segmentIdx));
    }

    getAllSegments(sceneId: string): VideoSegment[] {
        const idx = this.read<number[]>(this.segmentIdxKey(sceneId)) ?? [];
        return idx
            .map(i => this.getSegment(sceneId, i))
            .filter((v): v is VideoSegment => v != null);
    }

    getSceneSegmentIdxs(sceneId: string): number[] {
        return this.read<number[]>(this.segmentIdxKey(sceneId)) ?? [];
    }

    saveAllSegments(sceneId: string, segments: VideoSegment[]): void {
        const idx = segments.map(s => parseInt(s.segment_id.split("_")[1] ?? "0", 10));
        this.write(this.segmentIdxKey(sceneId), idx);
        for (const seg of segments) {
            const segIdx = parseInt(seg.segment_id.split("_")[1] ?? "0", 10);
            this.write(this.segmentKey(sceneId, segIdx), seg);
        }
    }
}