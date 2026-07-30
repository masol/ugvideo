// nodes/assign-render-strategies/storage.ts
import { PrjDB } from "$libs/project/controllers/drizzle/index.js";
import type { IRunnerContext } from "$types/blueprint/context.js";
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

    decisionKey(name: string): string {
        return `${P}char:render_decision_${name}`;
    }

    saveDecision(decision: EntityRenderDecision): void {
        this.prjdb.set(this.decisionKey(decision.name), decision);

        // source_group 个体的决策需要单独维护索引，供下游 allRenderDecisions 汇总
        if (decision.source_group) {
            const idx = this.read<string[]>(`${P}char:idx:source_group_decisions`) ?? [];
            if (!idx.includes(decision.name)) {
                this.prjdb.set(`${P}char:idx:source_group_decisions`, [...idx, decision.name]);
            }
        }
    }
}