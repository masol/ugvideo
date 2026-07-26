// nodes/build-stage/storage.ts
import { PrjDB } from "$libs/project/controllers/drizzle/index.js";
import type {
    Beat,
    EntityImageRef,
    EntityKind,
    GlobalEntity,
    SceneStage,
} from "./types.js";

const GID_PREFIX: Record<EntityKind, string> = {
    character: "C",
    prop: "P",
    set: "L",
    light: "LT",
};

export class StageStorage {
    constructor(private prjdb: PrjDB) { }

    // ===== 场景静态舞台 =====
    saveStage(stage: SceneStage): void {
        const id = stage.world.scene_id;
        this.prjdb.set(`stage:scene:${id}`, stage);
        const idx = this.prjdb.get<string[]>("stage:idx") ?? [];
        if (!idx.includes(id)) this.prjdb.set("stage:idx", [...idx, id]);
    }
    loadStage(sceneId: string): SceneStage | null {
        return this.prjdb.get<SceneStage>(`stage:scene:${sceneId}`) ?? null;
    }
    listStageIds(): string[] {
        return this.prjdb.get<string[]>("stage:idx") ?? [];
    }

    // ===== 节拍时间线（独立表）=====
    saveBeats(sceneId: string, beats: Beat[]): void {
        this.prjdb.set(`stage:beats:${sceneId}`, beats);
    }
    loadBeats(sceneId: string): Beat[] {
        return this.prjdb.get<Beat[]>(`stage:beats:${sceneId}`) ?? [];
    }

    // ===== 场景情绪简报 =====
    saveEmotion(sceneId: string, nl: string): void {
        this.prjdb.set(`stage:emotion:${sceneId}`, nl);
    }
    loadEmotion(sceneId: string): string | null {
        return this.prjdb.get<string>(`stage:emotion:${sceneId}`);
    }

    // ===== 全局实体登记册 =====
    listGlobalIds(): string[] {
        return this.prjdb.get<string[]>("stage:registry:idx") ?? [];
    }
    loadGlobal(gid: string): GlobalEntity | null {
        return this.prjdb.get<GlobalEntity>(`stage:registry:${gid}`) ?? null;
    }
    listGlobals(): GlobalEntity[] {
        return this.listGlobalIds()
            .map((g) => this.loadGlobal(g))
            .filter((e): e is GlobalEntity => e != null);
    }
    saveGlobal(entity: GlobalEntity): void {
        this.prjdb.set(`stage:registry:${entity.gid}`, entity);
        const idx = this.prjdb.get<string[]>("stage:registry:idx") ?? [];
        if (!idx.includes(entity.gid)) {
            this.prjdb.set("stage:registry:idx", [...idx, entity.gid]);
        }
    }
    /** 生成下一个某类别的全局 id */
    nextGid(kind: EntityKind): string {
        const prefix = GID_PREFIX[kind];
        const used = this.listGlobalIds()
            .filter((g) => g.startsWith(prefix))
            .map((g) => parseInt(g.slice(prefix.length), 10))
            .filter((n) => !Number.isNaN(n));
        const next = (used.length ? Math.max(...used) : 0) + 1;
        return `${prefix}${String(next).padStart(2, "0")}`;
    }

    // ===== 图片历史（首次/二次出图）=====
    recordImage(gid: string, ref: EntityImageRef): void {
        const e = this.loadGlobal(gid);
        if (!e) return;
        e.image_history = [...(e.image_history ?? []), ref];
        this.saveGlobal(e);
    }
    getAnchorImage(gid: string): EntityImageRef | null {
        const e = this.loadGlobal(gid);
        return e?.image_history?.find((r) => r.is_anchor) ?? null;
    }
    hasAnchorImage(gid: string): boolean {
        return this.getAnchorImage(gid) != null;
    }

    // ===== 下游总览 =====
    saveStagesSummary(nl: string): void {
        this.prjdb.set("state:stages_nl", nl);
    }
    getStagesSummary(): string | null {
        return this.prjdb.get<string>("state:stages_nl");
    }
}