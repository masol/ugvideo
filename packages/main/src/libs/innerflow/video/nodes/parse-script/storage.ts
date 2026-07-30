// parse-script/storage.ts
import { PrjDB } from "$libs/project/controllers/drizzle/index.js";
import type { IRunnerContext } from "$types/blueprint/context.js";
import type { GlobalItem, PersistedScene, ScriptFormat } from "./types.js";

const P = "#video:";

export class ParseStorage {
    private prjdb: PrjDB;

    constructor(ctx: IRunnerContext) {
        this.prjdb = PrjDB.ensure(ctx.prj);
    }

    getScriptPart(id: string): string | null {
        return this.prjdb.get<string>(`script_${id}`);
    }

    // ===== Format =====
    saveFormat(fmt: ScriptFormat): void {
        this.prjdb.set(`${P}parse:format`, fmt);
    }
    loadFormat(): ScriptFormat | null {
        return this.prjdb.get<ScriptFormat>(`${P}parse:format`) ?? null;
    }

    // ===== Global Items（跨 chunk 累积）=====
    appendGlobalItem(item: GlobalItem): void {
        const list = this.prjdb.get<GlobalItem[]>(`${P}parse:global_items`) ?? [];
        if (!list.some((g) => g.line_start === item.line_start)) {
            this.prjdb.set(`${P}parse:global_items`, [...list, item]);
        }
    }
    loadGlobalItems(): GlobalItem[] {
        return this.prjdb.get<GlobalItem[]>(`${P}parse:global_items`) ?? [];
    }

    // ===== Synopsis / World Context =====
    /**
     * 把剧本梗概/序言/编者按等"非场景内容"拼接为世界观摘要。
     * 来源：global_items 中 kind ∈ {synopsis, preface, note} 的条目，按 line_start 排序拼接 summary。
     * 若全部缺失，返回 null。
     */
    loadSynopsis(): string | null {
        const items = this.loadGlobalItems()
            .filter(g => /synopsis|preface|note/i.test(g.kind))
            .sort((a, b) => a.line_start - b.line_start);

        if (items.length === 0) return null;

        const merged = items.map(g => g.summary).filter(Boolean).join("\n\n");
        const trimmed = merged.trim();
        return trimmed.length > 0 ? trimmed : null;
    }

    saveSynopsis(text: string): void {
        this.prjdb.set(`${P}parse:synopsis`, text);
    }
    getCachedSynopsis(): string | null {
        return this.prjdb.get<string>(`${P}parse:synopsis`) ?? null;
    }

    // ===== Scenes =====
    saveScene(scene: PersistedScene): void {
        this.prjdb.set(`${P}parse:scene:${scene.scene_id}`, scene);
        const idx = this.prjdb.get<string[]>(`${P}parse:idx:scenes`) ?? [];
        if (!idx.includes(scene.scene_id)) {
            this.prjdb.set(`${P}parse:idx:scenes`, [...idx, scene.scene_id]);
        }
    }
    loadScene(id: string): PersistedScene | null {
        return this.prjdb.get<PersistedScene>(`${P}parse:scene:${id}`) ?? null;
    }
    listSceneIds(): string[] {
        return this.prjdb.get<string[]>(`${P}parse:idx:scenes`) ?? [];
    }

    reorderScenesByLine(): void {
        const ordered = this.listSceneIds()
            .slice()
            .sort((a, b) => {
                const sa = this.loadScene(a);
                const sb = this.loadScene(b);
                return (sa?.line_start ?? 0) - (sb?.line_start ?? 0);
            });
        this.prjdb.set(`${P}parse:idx:scenes`, ordered);
    }

    // ===== Cursor =====
    getCursor(): number {
        return this.prjdb.get<number>(`${P}parse:cursor`) ?? 1;
    }
    setCursor(lineNo: number): void {
        this.prjdb.set(`${P}parse:cursor`, lineNo);
    }
}