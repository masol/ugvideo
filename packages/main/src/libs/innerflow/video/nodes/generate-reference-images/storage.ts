// nodes/generate-reference-images/storage.ts
import { PrjDB } from "$libs/project/controllers/drizzle/index.js";
import type { IRunnerContext } from "$types/blueprint/context.js";
import type { GlobalEntity, SceneStage } from "../align-entities/types.js";
import type {
    CharacterIdentity,
    CostumeDesign,
    EntityRenderDecision,
    UniformDesign,
} from "../design-characters/types.js";
import type { EntityAsset, SceneLighting } from "../design-shots/types.js";
import type {
    EntityRefsheetPrompt,
    RenderResult,
    SceneEnvironmentPrompt,
    SceneShotPrompt,
} from "./types.js";

const P = "#video:";

export class RefImgStorage {
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

    // 上游数据
    sceneIds(): string[] {
        return this.read<string[]>(`${P}parse:idx:scenes`) ?? [];
    }

    entityNames(): string[] {
        return this.read<string[]>(`${P}stage:registry:idx`) ?? [];
    }

    getGlobalEntity(name: string): GlobalEntity | null {
        return this.read<GlobalEntity>(`${P}stage:registry:${name}`);
    }

    getStage(sceneId: string): SceneStage | null {
        return this.read<SceneStage>(`${P}state:stage_${sceneId}`);
    }

    getLighting(sceneId: string): SceneLighting | null {
        return this.read<SceneLighting>(`${P}shots:lighting_${sceneId}`);
    }

    getAlignedText(sceneId: string): string | null {
        return this.read<string>(`${P}output:aligned_text_${sceneId}`);
    }

    getShotDesign(sceneId: string): string | null {
        return this.read<string>(`${P}shots:design_${sceneId}`);
    }

    getStageAlign(sceneId: string): Record<string, string> | null {
        return this.read<Record<string, string>>(`${P}stage:align:${sceneId}`);
    }

    resolveToGlobalName(sceneId: string, localName: string): string {
        const mapping = this.getStageAlign(sceneId);
        if (!mapping) return localName;
        return mapping[localName] ?? localName;
    }

    getEntityAssetForScene(sceneId: string, entityName: string): EntityAsset | null {
        return this.read<EntityAsset>(`${P}shots:asset_${sceneId}_${entityName}`);
    }

    getEntityAsset(entityName: string): EntityAsset | null {
        const entity = this.getGlobalEntity(entityName);
        if (!entity || !entity.scenes.length) return null;
        const firstScene = entity.scenes[0];
        return this.read<EntityAsset>(`${P}shots:asset_${firstScene}_${entityName}`);
    }

    getIdentity(name: string): CharacterIdentity | null {
        return this.read<CharacterIdentity>(`${P}char:identity_${name}`);
    }

    getRenderDecision(name: string): EntityRenderDecision | null {
        return this.read<EntityRenderDecision>(`${P}char:render_decision_${name}`);
    }

    allRenderDecisions(): EntityRenderDecision[] {
        return this.entityNames()
            .map(n => this.getRenderDecision(n))
            .filter((v): v is EntityRenderDecision => v != null);
    }

    getUniform(uniformName: string): UniformDesign | null {
        return this.read<UniformDesign>(`${P}char:uniform_${uniformName}`);
    }

    getCostume(name: string, sceneId: string): CostumeDesign | null {
        return this.read<CostumeDesign>(`${P}char:costume_${name}_${sceneId}`);
    }

    getGlobalStyle(): { style: string; color_tone: string } {
        const style = this.read<string>("config:style") ?? "cinematic";
        const colorTone = this.read<string>("config:colorTone") ?? "neutral";
        return { style, color_tone: colorTone };
    }

    entityRefsheetKey(entityName: string): string {
        return `${P}refimg:entity_${entityName}`;
    }

    getEntityRefsheet(entityName: string): EntityRefsheetPrompt | null {
        return this.read<EntityRefsheetPrompt>(this.entityRefsheetKey(entityName));
    }

    saveEntityRefsheet(prompt: EntityRefsheetPrompt): void {
        this.write(this.entityRefsheetKey(prompt.entity_name), prompt);
        const idx = this.generatedEntityNames();
        if (!idx.includes(prompt.entity_name)) {
            this.write(`${P}refimg:idx:entities`, [...idx, prompt.entity_name]);
        }
    }

    generatedEntityNames(): string[] {
        return this.read<string[]>(`${P}refimg:idx:entities`) ?? [];
    }

    uniformPromptKey(uniformName: string): string {
        return `${P}refimg:uniform_${uniformName}`;
    }

    getUniformPrompt(uniformName: string): EntityRefsheetPrompt | null {
        return this.read<EntityRefsheetPrompt>(this.uniformPromptKey(uniformName));
    }

    saveUniformPrompt(prompt: EntityRefsheetPrompt): void {
        this.write(this.uniformPromptKey(prompt.entity_name), prompt);
        const idx = this.uniformPromptIdx();
        if (!idx.includes(prompt.entity_name)) {
            this.write(`${P}refimg:idx:uniforms`, [...idx, prompt.entity_name]);
        }
    }

    uniformPromptIdx(): string[] {
        return this.read<string[]>(`${P}refimg:idx:uniforms`) ?? [];
    }

    sceneEnvironmentKey(sceneId: string): string {
        return `${P}refimg:env_${sceneId}`;
    }

    getSceneEnvironment(sceneId: string): SceneEnvironmentPrompt | null {
        return this.read<SceneEnvironmentPrompt>(this.sceneEnvironmentKey(sceneId));
    }

    saveSceneEnvironment(prompt: SceneEnvironmentPrompt): void {
        this.write(this.sceneEnvironmentKey(prompt.scene_id), prompt);
        const idx = this.generatedSceneIds();
        if (!idx.includes(prompt.scene_id)) {
            this.write(`${P}refimg:idx:scenes`, [...idx, prompt.scene_id]);
        }
    }

    generatedSceneIds(): string[] {
        return this.read<string[]>(`${P}refimg:idx:scenes`) ?? [];
    }

    // 场景镜头提示词
    shotPromptKey(sceneId: string, shotIndex: number): string {
        return `${P}refimg:shot_${sceneId}_${shotIndex}`;
    }

    getShotPrompt(sceneId: string, shotIndex: number): SceneShotPrompt | null {
        return this.read<SceneShotPrompt>(this.shotPromptKey(sceneId, shotIndex));
    }

    saveShotPrompt(sceneId: string, shotIndex: number, prompt: SceneShotPrompt): void {
        this.write(this.shotPromptKey(sceneId, shotIndex), prompt);
    }

    shotPromptIdxKey(sceneId: string): string {
        return `${P}refimg:idx:shots_${sceneId}`;
    }

    getShotPromptIdx(sceneId: string): number[] {
        return this.read<number[]>(this.shotPromptIdxKey(sceneId)) ?? [];
    }

    saveShotPromptIdx(sceneId: string, shotIds: number[]): void {
        this.write(this.shotPromptIdxKey(sceneId), shotIds);
    }

    getSceneShotPrompts(sceneId: string): SceneShotPrompt[] {
        return this.getShotPromptIdx(sceneId)
            .map(i => this.getShotPrompt(sceneId, i))
            .filter((v): v is SceneShotPrompt => v != null);
    }

    renderResultKey(id: string): string {
        return `${P}refimg:rendered_${id}`;
    }

    getRenderResult(id: string): RenderResult | null {
        return this.read<RenderResult>(this.renderResultKey(id));
    }

    saveRenderResult(result: RenderResult): void {
        this.write(this.renderResultKey(result.id), result);
    }

    overviewKey(): string {
        return `${P}output:refimg_overview`;
    }

    saveOverview(text: string): void {
        this.write(this.overviewKey(), text);
    }
}