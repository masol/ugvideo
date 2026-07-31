// nodes/design-shots/storage.ts
import { PrjDB } from "$libs/project/controllers/drizzle/index.js";
import type { IRunnerContext } from "$types/blueprint/context.js";
import { isDeepStrictEqual } from "node:util";
import type { GlobalEntity, SceneStage } from "../align-entities/types.js";
import type {
    CharacterIdentity,
    CostumeDesign,
    EntityRenderDecision,
} from "../design-characters/types.js";
import type { AssetConstraint, EntityAsset, GlobalStyle, SceneLighting } from "./types.js";

const P = "#video:";

export class ShotStorage {
    private prjdb: ReturnType<typeof PrjDB.ensure>;

    constructor(ctx: IRunnerContext) {
        this.prjdb = PrjDB.ensure(ctx.prj);
    }

    private read<T>(key: string): T | null {
        return this.prjdb.get<T>(key) ?? null;
    }

    /**
     * 幂等写入：内容深度相等则跳过，不 bump 时间戳。
     * 通用规律，消除相同内容重写导致的下游级联过期。
     */
    private write<T>(key: string, value: T): void {
        const existing = this.prjdb.get<T>(key);
        if (isDeepStrictEqual(existing, value)) return;
        this.prjdb.set(key, value);
    }

    sceneIds(): string[] {
        return this.read<string[]>(`${P}parse:idx:scenes`) ?? [];
    }

    getAlignedText(sceneId: string): string | null {
        return this.read<string>(`${P}output:aligned_text_${sceneId}`);
    }

    getStage(sceneId: string): SceneStage | null {
        return this.read<SceneStage>(`${P}state:stage_${sceneId}`);
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

    getIdentity(name: string): CharacterIdentity | null {
        return this.read<CharacterIdentity>(`${P}char:identity_${name}`);
    }

    getCostume(name: string, sceneId: string): CostumeDesign | null {
        return this.read<CostumeDesign>(`${P}char:costume_${name}_${sceneId}`);
    }

    getFirstCostume(name: string): CostumeDesign | null {
        const entity = this.getGlobalEntity(name);
        if (!entity) return null;
        for (const sceneId of entity.scenes) {
            const c = this.getCostume(name, sceneId);
            if (c) return c;
        }
        return null;
    }

    /**
     * 按 (sceneId, entityName) 查决策。
     */
    getRenderDecision(sceneId: string, entityName: string): EntityRenderDecision | null {
        return this.read<EntityRenderDecision>(`${P}char:render_decision_${sceneId}_${entityName}`);
    }

    /**
     * 获取某场景的所有决策（通过自维护索引）。
     */
    private sceneDecisionIdxKey(sceneId: string): string {
        return `${P}char:idx:scene_decisions_${sceneId}`;
    }

    getSceneDecisions(sceneId: string): EntityRenderDecision[] {
        const names = this.read<string[]>(this.sceneDecisionIdxKey(sceneId)) ?? [];
        return names
            .map(n => this.getRenderDecision(sceneId, n))
            .filter((v): v is EntityRenderDecision => v != null);
    }

    allRenderDecisions(): EntityRenderDecision[] {
        const out: EntityRenderDecision[] = [];
        const designedScenes = this.read<string[]>(`${P}shots:idx:scenes`) ?? [];
        for (const sid of designedScenes) {
            out.push(...this.getSceneDecisions(sid));
        }
        return out;
    }

    getStageAlign(sceneId: string): Record<string, string> | null {
        return this.read<Record<string, string>>(`${P}stage:align:${sceneId}`);
    }

    resolveToGlobalName(sceneId: string, localName: string): string {
        const mapping = this.getStageAlign(sceneId);
        if (!mapping) return localName;
        return mapping[localName] ?? localName;
    }

    getSceneMeta(sceneId: string): Record<string, unknown> | null {
        return this.read<Record<string, unknown>>(`${P}parse:scene:${sceneId}`);
    }

    getGlobalStyle(): GlobalStyle {
        const pace = this.read<string>("config:pace") ?? "normal";
        const aspectRatio = this.read<string>("config:aspectRatio") ?? "9:16";
        const style = this.read<string>("config:style") ?? "cinematic";
        const audience = this.read<string>("config:audience") ?? "pg";
        const colorTone = this.read<string>("config:colorTone") ?? "neutral";
        const cameraMovement = this.read<string>("config:cameraMovement") ?? "smooth";

        return {
            aspect_ratio: aspectRatio,
            pacing: pace as "normal" | "slow" | "fast",
            style,
            audience: audience as "g" | "pg" | "pg13" | "r" | "nc17",
            color_tone: colorTone,
            camera_movement: cameraMovement,
        };
    }

    assetConstraintsKey(): string {
        return `${P}shots:asset_constraints`;
    }

    getAssetConstraints(): AssetConstraint[] {
        return this.read<AssetConstraint[]>(this.assetConstraintsKey()) ?? [];
    }

    saveAssetConstraints(constraints: AssetConstraint[]): void {
        this.write(this.assetConstraintsKey(), constraints);
    }

    upsertAssetConstraint(name: string, description: string, sourceScene: string): void {
        const constraints = this.getAssetConstraints();
        const existing = constraints.find(c => c.entity_name === name);
        if (existing) {
            if (!existing.visual_description.includes(description)) {
                existing.visual_description = existing.visual_description
                    ? `${existing.visual_description}；${description}`
                    : description;
            }
        } else {
            constraints.push({ entity_name: name, visual_description: description, source_scene: sourceScene });
        }
        this.saveAssetConstraints(constraints);
    }

    intentKey(sceneId: string): string {
        return `${P}shots:intent_${sceneId}`;
    }

    getIntent(sceneId: string): string | null {
        return this.read<string>(this.intentKey(sceneId));
    }

    saveIntent(sceneId: string, text: string): void {
        this.write(this.intentKey(sceneId), text);
    }

    shotSkillKey(sceneId: string): string {
        return `${P}shots:shot_skill_${sceneId}`;
    }

    getShotSkill(sceneId: string): string | null {
        return this.read<string>(this.shotSkillKey(sceneId));
    }

    saveShotSkill(sceneId: string, skill: string): void {
        this.write(this.shotSkillKey(sceneId), skill);
    }

    designKey(sceneId: string): string {
        return `${P}shots:design_${sceneId}`;
    }

    getDesign(sceneId: string): string | null {
        return this.read<string>(this.designKey(sceneId));
    }

    saveDesign(sceneId: string, text: string): void {
        this.write(this.designKey(sceneId), text);
    }

    lightingKey(sceneId: string): string {
        return `${P}shots:lighting_${sceneId}`;
    }

    getLighting(sceneId: string): SceneLighting | null {
        return this.read<SceneLighting>(this.lightingKey(sceneId));
    }

    saveLighting(sceneId: string, lighting: SceneLighting): void {
        this.write(this.lightingKey(sceneId), lighting);
    }

    entityAssetKey(sceneId: string, entityName: string): string {
        return `${P}shots:asset_${sceneId}_${entityName}`;
    }

    getEntityAsset(sceneId: string, entityName: string): EntityAsset | null {
        return this.read<EntityAsset>(this.entityAssetKey(sceneId, entityName));
    }

    saveEntityAsset(asset: EntityAsset): void {
        this.write(this.entityAssetKey(asset.scene_id, asset.entity_name), asset);
    }

    getSceneAssets(sceneId: string): EntityAsset[] {
        const stage = this.getStage(sceneId);
        if (!stage) return [];
        return stage.entities
            .map(e => {
                const globalName = this.resolveToGlobalName(sceneId, e.name);
                return this.getEntityAsset(sceneId, globalName);
            })
            .filter((v): v is EntityAsset => v != null);
    }

    designedSceneIds(): string[] {
        return this.read<string[]>(`${P}shots:idx:scenes`) ?? [];
    }

    markSceneDesigned(sceneId: string): void {
        const ids = this.designedSceneIds();
        if (!ids.includes(sceneId)) {
            this.write(`${P}shots:idx:scenes`, [...ids, sceneId]);
        }
    }

    overviewKey(): string {
        return `${P}output:shots_overview`;
    }

    saveOverview(text: string): void {
        this.write(this.overviewKey(), text);
    }
}