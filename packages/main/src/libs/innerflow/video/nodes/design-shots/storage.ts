// nodes/design-shots/storage.ts
import { PrjDB } from "$libs/project/controllers/drizzle/index.js";
import type { IRunnerContext } from "$types/blueprint/context.js";
import type { GlobalEntity, SceneStage } from "../align-entities/types.js";
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

    private write<T>(key: string, value: T): void {
        this.prjdb.set(key, value);
    }

    // --------------------------------------------------------
    // 上游数据（只读）
    // --------------------------------------------------------

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

    // --------------------------------------------------------
    // 全局视觉准则（配置项读取）
    // --------------------------------------------------------

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

    // --------------------------------------------------------
    // 素材全局约束
    // --------------------------------------------------------

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

    // --------------------------------------------------------
    // Pass A：场景意图
    // --------------------------------------------------------

    intentKey(sceneId: string): string {
        return `${P}shots:intent_${sceneId}`;
    }

    getIntent(sceneId: string): string | null {
        return this.read<string>(this.intentKey(sceneId));
    }

    saveIntent(sceneId: string, text: string): void {
        this.write(this.intentKey(sceneId), text);
    }

    // --------------------------------------------------------
    // SKILL
    // --------------------------------------------------------

    shotSkillKey(sceneId: string): string {
        return `${P}shots:shot_skill_${sceneId}`;
    }

    getShotSkill(sceneId: string): string | null {
        return this.read<string>(this.shotSkillKey(sceneId));
    }

    saveShotSkill(sceneId: string, skill: string): void {
        this.write(this.shotSkillKey(sceneId), skill);
    }

    assetSkillKey(sceneId: string): string {
        return `${P}shots:asset_skill_${sceneId}`;
    }

    getAssetSkill(sceneId: string): string | null {
        return this.read<string>(this.assetSkillKey(sceneId));
    }

    saveAssetSkill(sceneId: string, skill: string): void {
        this.write(this.assetSkillKey(sceneId), skill);
    }

    // --------------------------------------------------------
    // Pass B：分镜设计
    // --------------------------------------------------------

    designKey(sceneId: string): string {
        return `${P}shots:design_${sceneId}`;
    }

    getDesign(sceneId: string): string | null {
        return this.read<string>(this.designKey(sceneId));
    }

    saveDesign(sceneId: string, text: string): void {
        this.write(this.designKey(sceneId), text);
    }

    // --------------------------------------------------------
    // Pass C：场景光照
    // --------------------------------------------------------

    lightingKey(sceneId: string): string {
        return `${P}shots:lighting_${sceneId}`;
    }

    getLighting(sceneId: string): SceneLighting | null {
        return this.read<SceneLighting>(this.lightingKey(sceneId));
    }

    saveLighting(sceneId: string, lighting: SceneLighting): void {
        this.write(this.lightingKey(sceneId), lighting);
    }

    // --------------------------------------------------------
    // Pass D：逐实体素材（独立落盘）
    // --------------------------------------------------------

    entityAssetKey(sceneId: string, entityName: string): string {
        return `${P}shots:asset_${sceneId}_${entityName}`;
    }

    getEntityAsset(sceneId: string, entityName: string): EntityAsset | null {
        return this.read<EntityAsset>(this.entityAssetKey(sceneId, entityName));
    }

    saveEntityAsset(sceneId: string, asset: EntityAsset): void {
        this.write(this.entityAssetKey(sceneId, asset.entity_name), asset);
    }

    /** 获取某场景所有实体素材 */
    getSceneAssets(sceneId: string): EntityAsset[] {
        const stage = this.getStage(sceneId);
        if (!stage) return [];
        return stage.entities
            .map(e => this.getEntityAsset(sceneId, e.name))
            .filter((v): v is EntityAsset => v != null);
    }

    // --------------------------------------------------------
    // 场景设计索引
    // --------------------------------------------------------

    designedSceneIds(): string[] {
        return this.read<string[]>(`${P}shots:idx:scenes`) ?? [];
    }

    markSceneDesigned(sceneId: string): void {
        const ids = this.designedSceneIds();
        if (!ids.includes(sceneId)) {
            this.write(`${P}shots:idx:scenes`, [...ids, sceneId]);
        }
    }

    // --------------------------------------------------------
    // 总览
    // --------------------------------------------------------

    overviewKey(): string {
        return `${P}output:shots_overview`;
    }

    saveOverview(text: string): void {
        this.write(this.overviewKey(), text);
    }
}