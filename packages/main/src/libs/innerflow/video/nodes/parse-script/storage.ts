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

    saveFormat(fmt: ScriptFormat): void {
        this.prjdb.set(`${P}parse:format`, fmt);
    }
    loadFormat(): ScriptFormat | null {
        return this.prjdb.get<ScriptFormat>(`${P}parse:format`) ?? null;
    }

    appendGlobalItem(item: GlobalItem): void {
        const list = this.prjdb.get<GlobalItem[]>(`${P}parse:global_items`) ?? [];
        if (!list.some((g) => g.line_start === item.line_start)) {
            this.prjdb.set(`${P}parse:global_items`, [...list, item]);
        }
    }
    loadGlobalItems(): GlobalItem[] {
        return this.prjdb.get<GlobalItem[]>(`${P}parse:global_items`) ?? [];
    }

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

    /**
     * 修复：幂等排序，仅当顺序与现存不一致时才落盘，
     * 避免每次运行都刷新 #video:parse:idx:scenes 的时间戳
     * （旧实现即使已排序也会 set 一次，被下游误判为"新写入"导致反复重算）。
     */
    reorderScenesByLine(): void {
        const ordered = this.listSceneIds()
            .slice()
            .sort((a, b) => {
                const sa = this.loadScene(a);
                const sb = this.loadScene(b);
                return (sa?.line_start ?? 0) - (sb?.line_start ?? 0);
            });
        const current = this.prjdb.get<string[]>(`${P}parse:idx:scenes`) ?? [];
        if (current.length === ordered.length && current.every((id, i) => id === ordered[i])) {
            return;
        }
        this.prjdb.set(`${P}parse:idx:scenes`, ordered);
    }

    getCursor(): number {
        return this.prjdb.get<number>(`${P}parse:cursor`) ?? 1;
    }
    setCursor(lineNo: number): void {
        this.prjdb.set(`${P}parse:cursor`, lineNo);
    }
}