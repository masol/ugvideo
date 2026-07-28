// nodes/align-entities/storage.ts
import { PrjDB } from "$libs/project/controllers/drizzle/index.js";
import type { IRunnerContext } from "$types/blueprint/context.js";
import type { PersistedScene } from "../parse-script/types.js";
import { loadScriptLines, sliceScene } from "./script-lines.js";
import type { GlobalEntity, SceneStage } from "./types.js";

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

    private write<T>(key: string, value: T): void {
        this.prjdb.set(key, value);
    }

    private lines(): string[] {
        if (this._lines == null) {
            this._lines = loadScriptLines(this.ctx);
        }
        return this._lines;
    }

    // --------------------------------------------------------
    // 场景索引（parse-script 产出，本节点只读）
    // --------------------------------------------------------

    sceneIds(): string[] {
        return this.read<string[]>(`${P}parse:idx:scenes`) ?? [];
    }

    // --------------------------------------------------------
    // 场景原文与元信息
    // --------------------------------------------------------

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

    // --------------------------------------------------------
    // Pass A：静态舞台
    // --------------------------------------------------------

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

    // --------------------------------------------------------
    // Pass B：节拍时间线 NL（工作载体，不做 safefmt 提取）
    // --------------------------------------------------------

    beatNlKey(sceneId: string): string {
        return `${P}state:beat_nl_${sceneId}`;
    }

    getBeatNl(sceneId: string): string | null {
        return this.read<string>(this.beatNlKey(sceneId));
    }

    saveBeatNl(sceneId: string, text: string): void {
        this.write(this.beatNlKey(sceneId), text);
    }

    // --------------------------------------------------------
    // Pass C：名称对齐后的场景原文
    // --------------------------------------------------------

    alignedTextKey(sceneId: string): string {
        return `${P}output:aligned_text_${sceneId}`;
    }

    getAlignedText(sceneId: string): string | null {
        return this.read<string>(this.alignedTextKey(sceneId));
    }

    saveAlignedText(sceneId: string, text: string): void {
        this.write(this.alignedTextKey(sceneId), text);
    }

    // --------------------------------------------------------
    // Pass D：全局实体登记册
    // --------------------------------------------------------

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

    /** 从登记册删除一个实体（合并时用） */
    removeGlobalEntity(name: string): void {
        this.prjdb.remove(this.registryKey(name));
        const names = this.entityNames().filter(n => n !== name);
        this.write(`${P}stage:registry:idx`, names);
    }

    addSceneToEntity(name: string, sceneId: string): void {
        const e = this.getGlobalEntity(name);
        if (!e) return;
        if (!e.scenes.includes(sceneId)) {
            this.upsertGlobalEntity({ ...e, scenes: [...e.scenes, sceneId] });
        }
    }

    // --------------------------------------------------------
    // Pass D：场景对齐映射
    // --------------------------------------------------------

    alignKey(sceneId: string): string {
        return `${P}stage:align:${sceneId}`;
    }

    getStageAlign(sceneId: string): Record<string, string> | null {
        return this.read<Record<string, string>>(this.alignKey(sceneId));
    }

    saveStageAlign(sceneId: string, mapping: Record<string, string>): void {
        this.write(this.alignKey(sceneId), mapping);
    }

    /** 批量更新所有场景 align 映射中对某个旧名的引用 */
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

    // --------------------------------------------------------
    // 总览输出
    // --------------------------------------------------------

    getOverview(): string | null {
        return this.read<string>(`${P}output:stage_overview`);
    }

    saveOverview(text: string): void {
        this.write(`${P}output:stage_overview`, text);
    }
}