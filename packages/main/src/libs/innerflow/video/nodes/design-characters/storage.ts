// nodes/design-characters/storage.ts
import { PrjDB } from "$libs/project/controllers/drizzle/index.js";
import type { IRunnerContext } from "$types/blueprint/context.js";
import { isDeepStrictEqual } from "node:util";
import type { GlobalEntity, SceneStage } from "../align-entities/types.js";
import type {
    CharacterIdentity,
    CostumeDesign,
    EntityRenderDecision,
    UniformDesign,
} from "./types.js";

const P = "#video:";

export class CharDesignStorage {
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

    allGlobalEntities(): GlobalEntity[] {
        return this.entityNames()
            .map(n => this.getGlobalEntity(n))
            .filter((v): v is GlobalEntity => v != null);
    }

    getAlignedText(sceneId: string): string | null {
        return this.read<string>(`${P}output:aligned_text_${sceneId}`);
    }

    getStage(sceneId: string): SceneStage | null {
        return this.read<SceneStage>(`${P}state:stage_${sceneId}`);
    }

    // --------------------------------------------------------
    // 角色身份
    // --------------------------------------------------------

    identityKey(name: string): string {
        return `${P}char:identity_${name}`;
    }

    getIdentity(name: string): CharacterIdentity | null {
        return this.read<CharacterIdentity>(this.identityKey(name));
    }

    saveIdentity(identity: CharacterIdentity): void {
        this.write(this.identityKey(identity.name), identity);
    }

    allIdentities(): CharacterIdentity[] {
        return this.entityNames()
            .map(n => this.getIdentity(n))
            .filter((v): v is CharacterIdentity => v != null);
    }

    // --------------------------------------------------------
    // 服装设计（个体角色）
    // --------------------------------------------------------

    costumeKey(name: string, sceneId: string): string {
        return `${P}char:costume_${name}_${sceneId}`;
    }

    getCostume(name: string, sceneId: string): CostumeDesign | null {
        return this.read<CostumeDesign>(this.costumeKey(name, sceneId));
    }

    saveCostume(name: string, sceneId: string, costume: CostumeDesign): void {
        this.write(this.costumeKey(name, sceneId), costume);
    }

    /** 获取角色的首次服装设计（作为后续场景的基准） */
    getFirstCostume(name: string): CostumeDesign | null {
        const entity = this.getGlobalEntity(name);
        if (!entity) return null;
        for (const sceneId of entity.scenes) {
            const c = this.getCostume(name, sceneId);
            if (c) return c;
        }
        return null;
    }

    // --------------------------------------------------------
    // 制服设计（群体）
    // --------------------------------------------------------

    uniformKey(uniformName: string): string {
        return `${P}char:uniform_${uniformName}`;
    }

    getUniform(uniformName: string): UniformDesign | null {
        return this.read<UniformDesign>(this.uniformKey(uniformName));
    }

    saveUniform(uniform: UniformDesign): void {
        this.write(this.uniformKey(uniform.uniform_name), uniform);
        const idx = this.uniformNames();
        if (!idx.includes(uniform.uniform_name)) {
            this.write(`${P}char:idx:uniforms`, [...idx, uniform.uniform_name]);
        }
    }

    uniformNames(): string[] {
        return this.read<string[]>(`${P}char:idx:uniforms`) ?? [];
    }

    // --------------------------------------------------------
    // 渲染策略
    // --------------------------------------------------------

    renderDecisionKey(name: string): string {
        return `${P}char:render_decision_${name}`;
    }

    getRenderDecision(name: string): EntityRenderDecision | null {
        return this.read<EntityRenderDecision>(this.renderDecisionKey(name));
    }

    saveRenderDecision(decision: EntityRenderDecision): void {
        this.write(this.renderDecisionKey(decision.name), decision);
    }

    allRenderDecisions(): EntityRenderDecision[] {
        return this.entityNames()
            .map(n => this.getRenderDecision(n))
            .filter((v): v is EntityRenderDecision => v != null);
    }

    // --------------------------------------------------------
    // 总览
    // --------------------------------------------------------

    overviewKey(): string {
        return `${P}output:char_design_overview`;
    }

    saveOverview(text: string): void {
        this.write(this.overviewKey(), text);
    }

    getSynopsis(): string | null {
        return this.read<string>(`${P}parse:synopsis`) ?? null;
    }
}