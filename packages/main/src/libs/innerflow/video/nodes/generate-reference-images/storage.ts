// nodes/generate-reference-images/storage.ts
import { PrjDB } from "$libs/project/controllers/drizzle/index.js";
import type { IRunnerContext } from "$types/blueprint/context.js";
import type { GlobalEntity, SceneStage } from "../align-entities/types.js";
import type { EntityAsset, SceneLighting } from "../design-shots/types.js";
import type { EntityRefsheetPrompt, RenderResult, SceneEnvironmentPrompt } from "./types.js";

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

    // --------------------------------------------------------
    // 上游数据（只读）
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

    /** 获取实体的素材描述（从首次出现的场景读取） */
    getEntityAsset(entityName: string): EntityAsset | null {
        const entity = this.getGlobalEntity(entityName);
        if (!entity || !entity.scenes.length) return null;

        const firstScene = entity.scenes[0];
        return this.read<EntityAsset>(`${P}shots:asset_${firstScene}_${entityName}`);
    }

    // --------------------------------------------------------
    // 全局视觉准则（配置项读取）
    // --------------------------------------------------------

    getGlobalStyle(): { style: string; color_tone: string } {
        const style = this.read<string>("config:style") ?? "cinematic";
        const colorTone = this.read<string>("config:colorTone") ?? "neutral";
        return { style, color_tone: colorTone };
    }

    // --------------------------------------------------------
    // SKILL（翻译步骤）
    // --------------------------------------------------------

    refsheetSkillKey(entityName: string): string {
        return `${P}refimg:skill_entity_${entityName}`;
    }

    getRefsheetSkill(entityName: string): string | null {
        return this.read<string>(this.refsheetSkillKey(entityName));
    }

    saveRefsheetSkill(entityName: string, skill: string): void {
        this.write(this.refsheetSkillKey(entityName), skill);
    }

    // --------------------------------------------------------
    // 实体定妆照提示词
    // --------------------------------------------------------

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

    // --------------------------------------------------------
    // 场景环境图提示词
    // --------------------------------------------------------

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

    // --------------------------------------------------------
    // 渲染结果（图片文件路径）
    // --------------------------------------------------------

    renderResultKey(id: string): string {
        return `${P}refimg:rendered_${id}`;
    }

    getRenderResult(id: string): RenderResult | null {
        return this.read<RenderResult>(this.renderResultKey(id));
    }

    saveRenderResult(result: RenderResult): void {
        this.write(this.renderResultKey(result.id), result);
    }

    // --------------------------------------------------------
    // 总览
    // --------------------------------------------------------

    overviewKey(): string {
        return `${P}output:refimg_overview`;
    }

    saveOverview(text: string): void {
        this.write(this.overviewKey(), text);
    }
}