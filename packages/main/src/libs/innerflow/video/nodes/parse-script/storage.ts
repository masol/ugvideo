// parse-script/storage.ts
import { PrjDB } from "$libs/project/controllers/drizzle/index.js";
import type { IRunnerContext } from "$types/blueprint/context.js";
import { isDeepStrictEqual } from "node:util";
import type {
    ChunkProcessResult,
    GlobalItem,
    PersistedScene,
    ScriptFormat,
} from "./types.js";

const P = "#video:";

export class ParseStorage {
    private prjdb: PrjDB;

    constructor(ctx: IRunnerContext) {
        this.prjdb = PrjDB.ensure(ctx.prj);
    }

    /**
     * 幂等写入：内容深度相等则跳过，不 bump 时间戳。
     * 关键：持久化经过 JSON 序列化会丢弃值为 undefined 的键。
     */
    private write<T>(key: string, value: T): void {
        const normalized = JSON.parse(JSON.stringify(value)) as T;
        const existing = this.prjdb.get<T>(key);
        if (isDeepStrictEqual(existing, normalized)) return;
        this.prjdb.set(key, normalized);
    }

    getScriptPart(id: string): string | null {
        return this.prjdb.get<string>(`script_${id}`);
    }

    saveFormat(fmt: ScriptFormat): void {
        this.write(`${P}parse:format`, fmt);
    }
    loadFormat(): ScriptFormat | null {
        return this.prjdb.get<ScriptFormat>(`${P}parse:format`) ?? null;
    }

    appendGlobalItem(item: GlobalItem): void {
        const list = this.prjdb.get<GlobalItem[]>(`${P}parse:global_items`) ?? [];
        if (!list.some((g) => g.line_start === item.line_start)) {
            this.write(`${P}parse:global_items`, [...list, item]);
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
        this.write(`${P}parse:synopsis`, text);
    }
    getCachedSynopsis(): string | null {
        return this.prjdb.get<string>(`${P}parse:synopsis`) ?? null;
    }

    saveScene(scene: PersistedScene): void {
        this.write(`${P}parse:scene:${scene.scene_id}`, scene);
        const idx = this.prjdb.get<string[]>(`${P}parse:idx:scenes`) ?? [];
        if (!idx.includes(scene.scene_id)) {
            this.write(`${P}parse:idx:scenes`, [...idx, scene.scene_id]);
        }
    }
    loadScene(id: string): PersistedScene | null {
        return this.prjdb.get<PersistedScene>(`${P}parse:scene:${id}`) ?? null;
    }
    listSceneIds(): string[] {
        return this.prjdb.get<string[]>(`${P}parse:idx:scenes`) ?? [];
    }

    /**
     * 幂等排序：仅当顺序与现存不一致时才落盘。
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
        this.write(`${P}parse:idx:scenes`, ordered);
    }

    getCursor(): number {
        return this.prjdb.get<number>(`${P}parse:cursor`) ?? 1;
    }
    setCursor(lineNo: number): void {
        this.write(`${P}parse:cursor`, lineNo);
    }

    // ===== chunk 处理结果（processChunk gate output）=====

    /**
     * chunk 处理结果 KV。
     *
     * gate 用法：
     * - input: #video:parse:idx:scenes + (可选) #video:parse:format
     * - output: chunkResultKey(chunk_id)
     *
     * 当场景索引与已知格式都未变时，chunk 结果可复用，避免每次重跑 LLM。
     */
    private chunkResultKey(chunkId: string): string {
        return `${P}parse:chunk_result:${chunkId}`;
    }

    getChunkResult(chunkId: string): ChunkProcessResult | null {
        return this.read(this.chunkResultKey(chunkId));
    }

    saveChunkResult(chunkId: string, result: ChunkProcessResult): void {
        this.write(this.chunkResultKey(chunkId), result);
    }

    private read<T>(key: string): T | null {
        return this.prjdb.get<T>(key) ?? null;
    }
}