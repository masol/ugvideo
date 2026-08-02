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
     * 返回值：true = 实际落盘，false = 幂等跳过。
     */
    private write<T>(key: string, value: T): boolean {
        const normalized = JSON.parse(JSON.stringify(value)) as T;
        const existing = this.prjdb.get<T>(key);
        if (isDeepStrictEqual(existing, normalized)) return false;
        this.ctx.info(`[Storage.write] 实际落盘：${key}`);   // ← 加这行
        this.prjdb.set(key, normalized);
        return true;
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

    /**
  * 写入对齐语义（registry 主体）。
  *
  * 严格幂等 + 防覆盖：
  * - 若实体已存在，scenes 做并集合并（绝不用传入的 scenes 覆盖已有的），
  *   避免 alignScene 重跑走新增分支时把跨场景实体的 scenes 抹回单场景。
  * - 合并后交给幂等 write：内容相同则不落盘、不刷新时间戳。
  *
  * 这保证「alignScene 因 gate 误判而重跑」时，只要对齐结果不变，registry 就不被写脏，
  * 从而不污染以 registry:* 为 gate input 的 auditRegistry。
  */
    upsertGlobalEntity(entity: GlobalEntity): void {
        const names = this.entityNames();
        const existing = this.getGlobalEntity(entity.name);

        // 防覆盖：已存在则 scenes 取并集，不用传入值直接覆盖
        const merged: GlobalEntity = existing
            ? {
                ...entity,
                scenes: Array.from(new Set([...existing.scenes, ...entity.scenes])).sort(),
            }
            : entity;

        this.write(this.registryKey(merged.name), merged);   // 幂等：内容同则不写
        if (!names.includes(merged.name)) {
            this.write(`${P}stage:registry:idx`, [...names, merged.name]);
        }
    }

    addSceneToEntity(name: string, sceneId: string): void {
        const e = this.getGlobalEntity(name);
        if (!e) return;
        if (!e.scenes.includes(sceneId)) {
            // 走 upsert（内部并集合并 + 幂等）
            this.upsertGlobalEntity({ ...e, scenes: [...e.scenes, sceneId] });
        }
        // 已包含 sceneId → 什么都不做，绝不触碰 registry
    }

    debugGetTime(key: string): string | null {
        const raw = this.prjdb.getWithTime(key);
        return raw?.updatedAt ?? null;
    }

    removeGlobalEntity(name: string): void {
        this.prjdb.remove(this.registryKey(name));
        // 同步清理派生 KV，避免幽灵数据
        this.prjdb.remove(this.timeSkipsKey(name));
        this.prjdb.remove(this.snapshotsKey(name));
        const names = this.entityNames().filter(n => n !== name);
        this.write(`${P}stage:registry:idx`, names);
    }


    // ===== 派生标记：time_skips（独立 KV）=====

    /**
     * 与 GlobalEntity 解耦的派生 KV。
     * 写入此 key 不会刷新 GlobalEntity 的 updatedAt，因此不会污染以 registry:* 为
     * gate input 的下游审计节点。
     */
    private timeSkipsKey(name: string): string {
        return `${P}stage:time_skips:${name}`;
    }

    getTimeSkips(name: string): Record<string, boolean> {
        return this.read<Record<string, boolean>>(this.timeSkipsKey(name)) ?? {};
    }

    /**
     * 标记某实体在某场景是否时间跳跃。
     * 幂等：内容相等时跳过，不更新时间戳。
     * 返回值：true = 实际落盘，false = 幂等跳过。
     */
    markTimeSkip(name: string, sceneId: string, isSkip: boolean): boolean {
        const skips = this.getTimeSkips(name);
        if (skips[sceneId] === isSkip) return false;
        const updated = { ...skips, [sceneId]: isSkip };
        return this.write(this.timeSkipsKey(name), updated);
    }

    /**
     * 给 audit/渲染报告用：一次性拿到某实体的时间跳跃集合。
     */
    getTimeSkipsForEntity(name: string): Record<string, boolean> {
        return this.getTimeSkips(name);
    }

    /**
     * 整批写入时间跳跃（scanTimeSkips 优化路径）。
     * 幂等：内容相等时跳过。
     */
    saveTimeSkips(name: string, skips: Record<string, boolean>): boolean {
        return this.write(this.timeSkipsKey(name), skips);
    }

    // ===== 派生标记：scene_snapshots（独立 KV）=====

    private snapshotsKey(name: string): string {
        return `${P}stage:snapshots:${name}`;
    }

    /**
     * 取某实体的全部 scene snapshot 列表（按 scene_id 升序便于稳定比较）。
     */
    getSceneSnapshots(name: string): SceneSnapshotRef[] {
        const list = this.read<SceneSnapshotRef[]>(this.snapshotsKey(name)) ?? [];
        return [...list].sort((a, b) => a.scene_id.localeCompare(b.scene_id));
    }

    getSceneSnapshot(name: string, sceneId: string): SceneSnapshotRef | null {
        return this.getSceneSnapshots(name).find(s => s.scene_id === sceneId) ?? null;
    }

    /**
     * 写入场景快照引用。当 scene_id 已存在时替换；否则追加。
     * 幂等：内容相等时跳过，不更新时间戳。
     * 返回值：true = 实际落盘，false = 幂等跳过。
     */
    upsertSceneSnapshot(name: string, ref: SceneSnapshotRef): boolean {
        const list = this.read<SceneSnapshotRef[]>(this.snapshotsKey(name)) ?? [];
        const existingIdx = list.findIndex(s => s.scene_id === ref.scene_id);
        if (existingIdx >= 0) {
            if (isDeepStrictEqual(list[existingIdx], ref)) return false;
            const updated = [...list];
            updated[existingIdx] = ref;
            return this.write(this.snapshotsKey(name), updated);
        }
        const updated = [...list, ref];
        return this.write(this.snapshotsKey(name), updated);
    }

    alignKey(sceneId: string): string {
        return `${P}stage:align:${sceneId}`;
    }

    getStageAlign(sceneId: string): Record<string, string> | null {
        return this.read<Record<string, string>>(this.alignKey(sceneId));
    }

    saveStageAlign(sceneId: string, mapping: Record<string, string>): boolean {
        return this.write(this.alignKey(sceneId), mapping);
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

    wornPropsKey(sceneId: string): string {
        return `${P}state:worn_props_${sceneId}`;
    }

    getWornProps(sceneId: string): Record<string, Array<{ name: string; appearance: string }>> {
        return this.read<Record<string, Array<{ name: string; appearance: string }>>>(this.wornPropsKey(sceneId)) ?? {};
    }

    saveWornProps(sceneId: string, mapping: Map<string, Array<{ name: string; appearance: string }>>): boolean {
        const obj: Record<string, Array<{ name: string; appearance: string }>> = {};
        for (const [k, v] of mapping) obj[k] = v;
        return this.write(this.wornPropsKey(sceneId), obj);
    }

    getOverview(): string | null {
        return this.read<string>(`${P}output:stage_overview`);
    }

    saveOverview(text: string): void {
        this.write(`${P}output:stage_overview`, text);
    }

    // ===== 审计状态 =====

    auditStateKey(): string {
        return `${P}stage:audit:state`;
    }

    getAuditState(): { last_completed_round: number; needs_continue: boolean } | null {
        return this.read(`${P}stage:audit:state`);
    }

    saveAuditState(state: { last_completed_round: number; needs_continue: boolean }): void {
        this.write(this.auditStateKey(), state);
    }
}