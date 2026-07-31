// nodes/align-entities/storage.ts
import { PrjDB } from "$libs/project/controllers/drizzle/index.js";
import type { IRunnerContext } from "$types/blueprint/context.js";
import { isDeepStrictEqual } from "node:util";
import type { PersistedScene } from "../parse-script/types.js";
import { loadScriptLines, sliceScene } from "./script-lines.js";
import type { GlobalEntity, SceneSnapshotRef, SceneStage } from "./types.js";

const P = "#video:";

export class Storage {
    private prjdb: ReturnType<typeof PrjDB.ensure>;
    private ctx: IRunnerContext;
    private _lines: string[] | null = null;

    constructor(ctx: IRunnerContext) {
        this.ctx = ctx;
        this.prjdb = PrjDB.ensure(ctx.prj);
    }

    private read<T>(key: string): T | null {
        return this.prjdb.get<T>(key);
    }

    /**
     * 幂等写入：内容深度相等时跳过，不刷新时间戳。
     * 相同内容 = 相同版本 = 不应使下游失效。
     *
     * 关键：持久化经过 JSON 序列化会丢弃值为 undefined 的键。
     * 若直接用内存中的 value（可能带 `foo: undefined`）与已回读的 existing 比较，
     * isDeepStrictEqual 会因"自有键集合不同"永远判为不等，导致每次都重写、
     * 刷新时间戳、误使下游过期。因此比较与写入都基于归一化（JSON 往返）后的值。
     */
    private write<T>(key: string, value: T): void {
        const normalized = JSON.parse(JSON.stringify(value)) as T;
        const existing = this.prjdb.get<T>(key);
        if (isDeepStrictEqual(existing, normalized)) return;
        this.prjdb.set(key, normalized);
    }

    private lines(): string[] {
        if (this._lines == null) {
            this._lines = loadScriptLines(this.ctx);
        }
        return this._lines;
    }

    sceneIds(): string[] {
        return this.read<string[]>(`${P}parse:idx:scenes`) ?? [];
    }

    private getPersistedScene(sceneId: string): PersistedScene | null {
        return this.read<PersistedScene>(`${P}parse:scene:${sceneId}`);
    }

    sceneInputKey(sceneId: string): string {
        return `${P}parse:scene:${sceneId}`;
    }

    getSceneMeta(sceneId: string): string | null {
        const s = this.getPersistedScene(sceneId);
        if (!s) return null;

        const c = s.context;
        const parts: string[] = [];
        parts.push(`标题：${s.title}`);
        if (c.episode) parts.push(`集：${c.episode}`);
        if (c.act) parts.push(`幕：${c.act}`);
        if (c.location) parts.push(`地点：${c.location}`);
        if (c.timeOfDay) parts.push(`时间：${c.timeOfDay}`);
        if (c.charactersInvolved?.length) {
            parts.push(`出场人物：${c.charactersInvolved.join("、")}`);
        }
        if (c.first_line_summary) parts.push(`概述：${c.first_line_summary}`);
        if (s.transition_from_prev) parts.push(`承接转场：${s.transition_from_prev}`);
        return parts.join("\n");
    }

    getSceneText(sceneId: string): string | null {
        const s = this.getPersistedScene(sceneId);
        if (!s) return null;
        const end = s.line_end > 0 ? s.line_end : this.lines().length;
        return sliceScene(this.lines(), s.line_start, end);
    }

    stageNlKey(sceneId: string): string {
        return `${P}state:stage_nl_${sceneId}`;
    }

    getStageNl(sceneId: string): string | null {
        return this.read<string>(this.stageNlKey(sceneId));
    }

    saveStageNl(sceneId: string, text: string): void {
        this.write(this.stageNlKey(sceneId), text);
    }

    stageKey(sceneId: string): string {
        return `${P}state:stage_${sceneId}`;
    }

    getStage(sceneId: string): SceneStage | null {
        return this.read<SceneStage>(this.stageKey(sceneId));
    }

    saveStage(sceneId: string, stage: SceneStage): void {
        this.write(this.stageKey(sceneId), stage);
    }

    beatNlKey(sceneId: string): string {
        return `${P}state:beat_nl_${sceneId}`;
    }

    getBeatNl(sceneId: string): string | null {
        return this.read<string>(this.beatNlKey(sceneId));
    }

    saveBeatNl(sceneId: string, text: string): void {
        this.write(this.beatNlKey(sceneId), text);
    }

    alignedTextKey(sceneId: string): string {
        return `${P}output:aligned_text_${sceneId}`;
    }

    getAlignedText(sceneId: string): string | null {
        return this.read<string>(this.alignedTextKey(sceneId));
    }

    saveAlignedText(sceneId: string, text: string): void {
        this.write(this.alignedTextKey(sceneId), text);
    }

    private registryKey(name: string): string {
        return `${P}stage:registry:${name}`;
    }

    entityNames(): string[] {
        return this.read<string[]>(`${P}stage:registry:idx`) ?? [];
    }

    getGlobalEntity(name: string): GlobalEntity | null {
        return this.read<GlobalEntity>(this.registryKey(name));
    }

    allGlobalEntities(): GlobalEntity[] {
        return this.entityNames()
            .map(n => this.getGlobalEntity(n))
            .filter((v): v is GlobalEntity => v != null);
    }

    upsertGlobalEntity(entity: GlobalEntity): void {
        const names = this.entityNames();
        this.write(this.registryKey(entity.name), entity);
        if (!names.includes(entity.name)) {
            this.write(`${P}stage:registry:idx`, [...names, entity.name]);
        }
    }

    removeGlobalEntity(name: string): void {
        this.prjdb.remove(this.registryKey(name));
        const names = this.entityNames().filter(n => n !== name);
        this.write(`${P}stage:registry:idx`, names);
    }

    addSceneToEntity(name: string, sceneId: string): void {
        const e = this.getGlobalEntity(name);
        if (!e) return;
        if (!e.scenes.includes(sceneId)) {
            const updated: GlobalEntity = { ...e, scenes: [...e.scenes, sceneId] };
            this.upsertGlobalEntity(updated);
        }
    }

    /**
     * 写入场景快照引用（design-characters 阶段回调）。
     * 当 scene_id 已存在时，替换而非追加；否则同 scene_id 重复调用会让数组长度+1，
     * 破坏幂等，导致每次执行都 bump 时间戳。
     */
    upsertSceneSnapshot(name: string, ref: SceneSnapshotRef): void {
        const e = this.getGlobalEntity(name);
        if (!e) return;
        const snapshots = e.scene_snapshots ?? [];
        const existingIdx = snapshots.findIndex(s => s.scene_id === ref.scene_id);
        if (existingIdx >= 0) {
            if (isDeepStrictEqual(snapshots[existingIdx], ref)) {
                return;
            }
            const updatedSnapshots = [...snapshots];
            updatedSnapshots[existingIdx] = ref;
            this.upsertGlobalEntity({ ...e, scene_snapshots: updatedSnapshots });
            return;
        }
        this.upsertGlobalEntity({ ...e, scene_snapshots: [...snapshots, ref] });
    }

    markTimeSkip(name: string, sceneId: string, isSkip: boolean): void {
        const e = this.getGlobalEntity(name);
        if (!e) return;
        const skips = e.time_skips ?? {};
        if (skips[sceneId] === isSkip) return;
        const updated: GlobalEntity = {
            ...e,
            time_skips: { ...skips, [sceneId]: isSkip },
        };
        this.upsertGlobalEntity(updated);
    }

    getSceneSnapshot(name: string, sceneId: string): SceneSnapshotRef | null {
        const e = this.getGlobalEntity(name);
        if (!e || !e.scene_snapshots) return null;
        return e.scene_snapshots.find(s => s.scene_id === sceneId) ?? null;
    }

    alignKey(sceneId: string): string {
        return `${P}stage:align:${sceneId}`;
    }

    getStageAlign(sceneId: string): Record<string, string> | null {
        return this.read<Record<string, string>>(this.alignKey(sceneId));
    }

    saveStageAlign(sceneId: string, mapping: Record<string, string>): void {
        this.write(this.alignKey(sceneId), mapping);
    }

    renameInAllAligns(oldName: string, newName: string): void {
        for (const sceneId of this.sceneIds()) {
            const mapping = this.getStageAlign(sceneId);
            if (!mapping) continue;
            let changed = false;
            for (const [localName, globalName] of Object.entries(mapping)) {
                if (globalName === oldName) {
                    mapping[localName] = newName;
                    changed = true;
                }
            }
            if (changed) this.saveStageAlign(sceneId, mapping);
        }
    }

    getOverview(): string | null {
        return this.read<string>(`${P}output:stage_overview`);
    }

    saveOverview(text: string): void {
        this.write(`${P}output:stage_overview`, text);
    }
}