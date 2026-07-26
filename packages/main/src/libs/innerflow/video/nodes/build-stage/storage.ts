// nodes/build-stage/storage.ts
import { PrjDB } from "$libs/project/controllers/drizzle/index.js";
import type { IRunnerContext } from "$types/blueprint/context.js";
import type { PersistedScene } from "../parse-script/types.js";
import { loadScriptLines, sliceScene } from "./script-lines.js";
import type { Beat, GlobalEntity, SceneStage } from "./types.js";

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

    /** 惰性加载剧本行数组（行号口径与 parse-script 完全一致） */
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
        return this.read<string[]>("parse:idx:scenes") ?? [];
    }

    // --------------------------------------------------------
    // 场景原文与元信息
    //   数据源为 parse-script 落盘的 parse:scene:{id}（只含行号区间），
    //   本节点按行号从脚本行数组切出原文，并把 context 渲染成元信息。
    // --------------------------------------------------------

    /** 读取 parse-script 落盘的场景记录 */
    private getPersistedScene(sceneId: string): PersistedScene | null {
        return this.read<PersistedScene>(`parse:scene:${sceneId}`);
    }

    /**
     * 供 checkExpiry 使用的 inputKey（门控元数据入参）。
     * 用真实上游产出 parse:scene:{id}，而非从未被写入的 state:scene_text_*。
     */
    sceneInputKey(sceneId: string): string {
        return `parse:scene:${sceneId}`;
    }

    /** 场景元信息（标题/集幕/地点/时间/出场人物/概述/转场），由 context 渲染 */
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

    /** 场景原文：按 parse-script 的 line_start/line_end 从脚本行数组切片 */
    getSceneText(sceneId: string): string | null {
        const s = this.getPersistedScene(sceneId);
        if (!s) return null;
        // line_end 由 parse-script 后处理回填；-1 表示异常，兜底到文件末尾
        const end = s.line_end > 0 ? s.line_end : this.lines().length;
        return sliceScene(this.lines(), s.line_start, end);
    }

    // --------------------------------------------------------
    // Pass A：静态舞台
    // --------------------------------------------------------

    /** Pass A NL 草稿的门控 key */
    stageNlKey(sceneId: string): string {
        return `state:stage_nl_${sceneId}`;
    }

    getStageNl(sceneId: string): string | null {
        return this.read<string>(this.stageNlKey(sceneId));
    }

    saveStageNl(sceneId: string, text: string): void {
        this.write(this.stageNlKey(sceneId), text);
    }

    /** Pass A 结构化舞台的门控 key */
    stageKey(sceneId: string): string {
        return `state:stage_${sceneId}`;
    }

    getStage(sceneId: string): SceneStage | null {
        return this.read<SceneStage>(this.stageKey(sceneId));
    }

    saveStage(sceneId: string, stage: SceneStage): void {
        this.write(this.stageKey(sceneId), stage);
    }

    // --------------------------------------------------------
    // Pass B：节拍时间线
    // --------------------------------------------------------

    /** Pass B NL 草稿的门控 key */
    beatNlKey(sceneId: string): string {
        return `state:beat_nl_${sceneId}`;
    }

    getBeatNl(sceneId: string): string | null {
        return this.read<string>(this.beatNlKey(sceneId));
    }

    saveBeatNl(sceneId: string, text: string): void {
        this.write(this.beatNlKey(sceneId), text);
    }

    /** Pass B 结构化节拍的门控 key */
    beatsKey(sceneId: string): string {
        return `state:beats_${sceneId}`;
    }

    getBeats(sceneId: string): Beat[] | null {
        return this.read<Beat[]>(this.beatsKey(sceneId));
    }

    saveBeats(sceneId: string, beats: Beat[]): void {
        this.write(this.beatsKey(sceneId), beats);
    }

    // --------------------------------------------------------
    // 全局实体登记册（跨场景身份，Pass D 对齐用，当前占位）
    // --------------------------------------------------------

    entityGids(): string[] {
        return this.read<string[]>("idx:global_entities") ?? [];
    }

    getGlobalEntity(gid: string): GlobalEntity | null {
        return this.read<GlobalEntity>(`state:gentity_${gid}`);
    }

    allGlobalEntities(): GlobalEntity[] {
        return this.entityGids()
            .map(gid => this.getGlobalEntity(gid))
            .filter((v): v is GlobalEntity => v != null);
    }

    upsertGlobalEntity(entity: GlobalEntity): void {
        const gids = this.entityGids();
        this.write(`state:gentity_${entity.gid}`, entity);
        if (!gids.includes(entity.gid)) {
            this.write("idx:global_entities", [...gids, entity.gid]);
        }
    }

    // --------------------------------------------------------
    // 最终总览输出
    // --------------------------------------------------------

    getOverview(): string | null {
        return this.read<string>("output:stage_overview");
    }

    saveOverview(text: string): void {
        this.write("output:stage_overview", text);
    }
}