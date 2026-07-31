// nodes/generate-reference-images/storage.ts
import { PrjDB } from "$libs/project/controllers/drizzle/index.js";
import type { IRunnerContext } from "$types/blueprint/context.js";
import { isDeepStrictEqual } from "node:util";
import type { GlobalEntity, SceneStage, StageEntity } from "../align-entities/types.js";
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

    /**
     * 幂等写入：内容深度相等则跳过，不 bump 时间戳。
     * 通用规律，消除相同内容重写导致的下游级联过期。
     */
    private write<T>(key: string, value: T): void {
        const existing = this.prjdb.get<T>(key);
        if (isDeepStrictEqual(existing, value)) return;
        this.prjdb.set(key, value);
    }

    // --------------------------------------------------------
    // 场景与实体
    // --------------------------------------------------------

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

    findSourceGroupEntity(entityName: string): { sceneId: string; stageEntity: StageEntity } | null {
        for (const sceneId of this.sceneIds()) {
            const stage = this.getStage(sceneId);
            if (!stage) continue;
            const stageEntity = stage.entities.find(e => e.name === entityName && e.source_group);
            if (stageEntity) return { sceneId, stageEntity };
        }
        return null;
    }

    getEntityAssetForScene(sceneId: string, entityName: string): EntityAsset | null {
        return this.read<EntityAsset>(`${P}shots:asset_${sceneId}_${entityName}`);
    }

    getEntityAsset(sceneId: string, entityName: string): EntityAsset | null {
        return this.read<EntityAsset>(`${P}shots:asset_${sceneId}_${entityName}`);
    }

    getFirstSceneForEntity(entityName: string): string | null {
        const entity = this.getGlobalEntity(entityName);
        if (!entity || !entity.scenes.length) return null;
        return entity.scenes[0];
    }

    getIdentity(name: string): CharacterIdentity | null {
        return this.read<CharacterIdentity>(`${P}char:identity_${name}`);
    }

    // --------------------------------------------------------
    // 决策（通过 assign-render-strategies 维护的索引读取）
    // --------------------------------------------------------

    private sceneDecisionIdxKey(sceneId: string): string {
        return `${P}char:idx:scene_decisions_${sceneId}`;
    }

    getRenderDecision(sceneId: string, entityName: string): EntityRenderDecision | null {
        return this.read<EntityRenderDecision>(`${P}char:render_decision_${sceneId}_${entityName}`);
    }

    getSceneDecisions(sceneId: string): EntityRenderDecision[] {
        const names = this.read<string[]>(this.sceneDecisionIdxKey(sceneId)) ?? [];
        return names
            .map(n => this.getRenderDecision(sceneId, n))
            .filter((v): v is EntityRenderDecision => v != null);
    }

    /**
     * 列出全部决策（通过已知的 designedSceneIds + 索引组合）。
     */
    allRenderDecisions(): EntityRenderDecision[] {
        const out: EntityRenderDecision[] = [];
        const designedScenes = this.read<string[]>(`${P}shots:idx:scenes`) ?? [];
        for (const sid of designedScenes) {
            out.push(...this.getSceneDecisions(sid));
        }
        return out;
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

    getIntent(sceneId: string): string | null {
        return this.read<string>(`${P}shots:intent_${sceneId}`);
    }

    // --------------------------------------------------------
    // 实体参考图（按场景隔离）
    // --------------------------------------------------------

    entityRefsheetKey(sceneId: string, entityName: string): string {
        return `${P}refimg:entity_${sceneId}_${entityName}`;
    }

    getEntityRefsheet(sceneId: string, entityName: string): EntityRefsheetPrompt | null {
        return this.read<EntityRefsheetPrompt>(this.entityRefsheetKey(sceneId, entityName));
    }

    saveEntityRefsheet(prompt: EntityRefsheetPrompt): void {
        this.write(this.entityRefsheetKey(prompt.scene_id, prompt.entity_name), prompt);
        const idx = this.read<string[]>(`${P}refimg:idx:entities`) ?? [];
        const id = `${prompt.scene_id}__${prompt.entity_name}`;
        if (!idx.includes(id)) {
            this.write(`${P}refimg:idx:entities`, [...idx, id]);
        }
    }

    generatedEntityRefsheets(): string[] {
        return this.read<string[]>(`${P}refimg:idx:entities`) ?? [];
    }

    parseEntityRefsheetKey(id: string): { sceneId: string; entityName: string } | null {
        const sep = id.indexOf("__");
        if (sep < 0) return null;
        return { sceneId: id.slice(0, sep), entityName: id.slice(sep + 2) };
    }

    /**
     * 列出某场景已生成的实体参考图（通过全局索引 + 过滤 sceneId 前缀）。
     */
    getSceneEntityRefsheets(sceneId: string): EntityRefsheetPrompt[] {
        const prefix = `${sceneId}__`;
        const out: EntityRefsheetPrompt[] = [];
        for (const id of this.generatedEntityRefsheets()) {
            if (!id.startsWith(prefix)) continue;
            const parsed = this.parseEntityRefsheetKey(id);
            if (!parsed) continue;
            const p = this.getEntityRefsheet(parsed.sceneId, parsed.entityName);
            if (p) out.push(p);
        }
        return out;
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

    getBeatNl(sceneId: string): string | null {
        return this.read<string>(`${P}state:beat_nl_${sceneId}`);
    }
}