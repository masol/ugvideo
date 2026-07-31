// nodes/assign-render-strategies/storage.ts
import { PrjDB } from "$libs/project/controllers/drizzle/index.js";
import type { IRunnerContext } from "$types/blueprint/context.js";
import { isDeepStrictEqual } from "node:util";
import type { GlobalEntity, SceneStage } from "../align-entities/types.js";
import type { EntityRenderDecision } from "../design-characters/types.js";

const P = "#video:";

export class RenderStratStorage {
    private prjdb: ReturnType<typeof PrjDB.ensure>;

    constructor(ctx: IRunnerContext) {
        this.prjdb = PrjDB.ensure(ctx.prj);
    }

    private read<T>(key: string): T | null {
        return this.prjdb.get<T>(key) ?? null;
    }

    /**
     * 幂等写入：内容深度相等则跳过，不 bump 时间戳。
     */
    private write<T>(key: string, value: T): void {
        const existing = this.prjdb.get<T>(key);
        if (isDeepStrictEqual(existing, value)) return;
        this.prjdb.set(key, value);
    }

    entityNames(): string[] {
        return this.read<string[]>(`${P}stage:registry:idx`) ?? [];
    }

    getGlobalEntity(name: string): GlobalEntity | null {
        return this.read<GlobalEntity>(`${P}stage:registry:${name}`);
    }

    allGlobalEntities(): GlobalEntity[] {
        return this.entityNames()
            .map(n => this.getGlobalEntity(n))
            .filter((v): v is GlobalEntity => v != null);
    }

    designedSceneIds(): string[] {
        return this.read<string[]>(`${P}shots:idx:scenes`) ?? [];
    }

    getShotDesign(sceneId: string): string | null {
        return this.read<string>(`${P}shots:design_${sceneId}`);
    }

    getStage(sceneId: string): SceneStage | null {
        return this.read<SceneStage>(`${P}state:stage_${sceneId}`);
    }

    getStageAlign(sceneId: string): Record<string, string> | null {
        return this.read<Record<string, string>>(`${P}stage:align:${sceneId}`);
    }

    resolveToGlobalName(sceneId: string, localName: string): string {
        const mapping = this.getStageAlign(sceneId);
        if (!mapping) return localName;
        return mapping[localName] ?? localName;
    }

    decisionKey(sceneId: string, entityName: string): string {
        return `${P}char:render_decision_${sceneId}_${entityName}`;
    }

    private sceneDecisionIdxKey(sceneId: string): string {
        return `${P}char:idx:scene_decisions_${sceneId}`;
    }

    saveDecision(sceneId: string, decision: EntityRenderDecision): void {
        this.write(this.decisionKey(sceneId, decision.name), decision);

        const idx = this.read<string[]>(this.sceneDecisionIdxKey(sceneId)) ?? [];
        if (!idx.includes(decision.name)) {
            this.write(this.sceneDecisionIdxKey(sceneId), [...idx, decision.name]);
        }
    }

    getDecision(sceneId: string, entityName: string): EntityRenderDecision | null {
        return this.read<EntityRenderDecision>(this.decisionKey(sceneId, entityName));
    }

    getSceneDecisions(sceneId: string): EntityRenderDecision[] {
        const names = this.read<string[]>(this.sceneDecisionIdxKey(sceneId)) ?? [];
        return names
            .map(n => this.getDecision(sceneId, n))
            .filter((v): v is EntityRenderDecision => v != null);
    }

    allDecisions(): EntityRenderDecision[] {
        const out: EntityRenderDecision[] = [];
        for (const sid of this.designedSceneIds()) {
            out.push(...this.getSceneDecisions(sid));
        }
        return out;
    }
}