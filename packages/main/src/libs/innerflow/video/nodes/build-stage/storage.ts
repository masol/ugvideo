// nodes/build-stage/storage.ts
import { PrjDB } from "$libs/project/controllers/drizzle/index.js";
import type { SceneStage } from "./types.js";

export class StageStorage {
    constructor(private prjdb: PrjDB) { }

    saveStage(stage: SceneStage): void {
        const id = stage.world.scene_id;
        this.prjdb.set(`stage:scene:${id}`, stage);
        const idx = this.prjdb.get<string[]>("stage:idx") ?? [];
        if (!idx.includes(id)) {
            this.prjdb.set("stage:idx", [...idx, id]);
        }
    }

    loadStage(sceneId: string): SceneStage | null {
        return this.prjdb.get<SceneStage>(`stage:scene:${sceneId}`) ?? null;
    }

    listStageIds(): string[] {
        return this.prjdb.get<string[]>("stage:idx") ?? [];
    }

    /** 下游可读的导演台总览（自然语言） */
    saveStagesSummary(nl: string): void {
        this.prjdb.set("state:stages_nl", nl);
    }
    getStagesSummary(): string | null {
        return this.prjdb.get<string>("state:stages_nl");
    }
}