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

    // ===== 入口：剧本正文分片（按 identified array 的 id 读取）=====
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

    /** 按 line_start 重排场景索引，保证下游遍历为叙事顺序 */
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