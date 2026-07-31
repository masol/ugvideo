// nodes/assign-render-strategies/index.ts
/* eslint-disable @typescript-eslint/no-explicit-any */
// nodes/assign-render-strategies/index.ts
import { checkExpiry } from "$libs/blueprint/glossary/expiry.js";
import type { IRunnerContext } from "$types/blueprint/context.js";
import type { GlobalEntity } from "../align-entities/types.js";
import type { EntityRenderDecision } from "../design-characters/types.js";
import { RenderStratStorage } from "./storage.js";

const P = "#video:";

/**
 * 渲染策略判定（按场景隔离）。
 *
 * 核心变化：
 * - 决策 key 改为 (sceneId, entityName)，每个 (实体, 场景) 对独立判定
 * - 同一实体在 S001 和 S002 可以有不同的策略（S001 prompt_only, S002 individual_refsheet）
 * - source_group 提升个体也按 (sceneId, entityName) 判定
 */
export async function assignRenderStrategies(ctx: IRunnerContext): Promise<void> {
    const store = new RenderStratStorage(ctx);
    const entities = store.allGlobalEntities();
    const sceneIds = store.designedSceneIds();

    if (!entities.length || !sceneIds.length) {
        ctx.info("[assignRenderStrategies] 无实体或无场景，跳过");
        return;
    }

    // 收集所有 (sceneId, entityName) 对
    const pairs: Array<{ sceneId: string; entity: GlobalEntity; stageEntity: any }> = [];

    for (const sceneId of sceneIds) {
        const stage = store.getStage(sceneId);
        if (!stage) continue;
        const stageAlign = store.getStageAlign(sceneId) ?? {};

        for (const stageEntity of stage.entities) {
            if (stageEntity.kind === "light") continue;
            const globalName = stageAlign[stageEntity.name] ?? stageEntity.name;
            const entity = store.getGlobalEntity(globalName);

            if (entity) {
                pairs.push({ sceneId, entity, stageEntity });
            } else if (stageEntity.source_group) {
                pairs.push({
                    sceneId,
                    entity: {
                        name: stageEntity.name,
                        kind: stageEntity.kind,
                        appearance: stageEntity.appearance ?? "",
                        scenes: [sceneId],
                        humanoid: stageEntity.humanoid,
                        count: stageEntity.count,
                        origin: "scene",
                        source_group: stageEntity.source_group,
                    } as any,
                    stageEntity,
                });
            }
        }
    }

    if (!pairs.length) {
        ctx.info("[assignRenderStrategies] 无可决策的 (scene, entity) 对，跳过");
        return;
    }

    // ===== 修复：gate 的 input/output keys 排序以稳定顺序 =====
    const outputKeys = pairs
        .map(p => store.decisionKey(p.sceneId, p.entity.name))
        .sort();

    const inputKeys = [
        `${P}stage:registry:idx`,
        `${P}shots:idx:scenes`,
        ...entities.map(e => `${P}stage:registry:${e.name}`),
        ...sceneIds.map(id => `${P}shots:design_${id}`),
        ...sceneIds.map(id => `${P}state:stage_${id}`),
        ...sceneIds.map(id => `${P}stage:align:${id}`),
    ].sort();

    if (!checkExpiry(ctx, {
        inputKeys,
        outputKeys,
    })) {
        ctx.info("[assignRenderStrategies] 所有策略决策仍新鲜，跳过");
        return;
    }

    const sceneRefs = collectEntityReferencesAcrossScenes(store);
    const decisions: EntityRenderDecision[] = [];

    for (const { sceneId, entity, stageEntity } of pairs) {
        void (stageEntity)
        const ref = sceneRefs.get(`${sceneId}::${entity.name}`);
        const referencedShotCount = ref?.referencedShotCount ?? 0;
        const closeUpShots = ref?.closeUpShots ?? 0;

        const decision = decideStrategy(
            ctx,
            sceneId,
            entity,
            referencedShotCount,
            closeUpShots,
        );

        store.saveDecision(sceneId, decision);
        decisions.push(decision);
    }

    decisions.sort(compareImportance);

    ctx.info(`[assignRenderStrategies] 完成，${decisions.length} 个决策（按场景隔离）`);
    for (const d of decisions) {
        ctx.info(`[assignRenderStrategies]   ${d.scene_id ?? "?"}/${d.name}: ${d.strategy}｜origin=${d.origin}｜shot=${d.referenced_shot_count}`);
    }
}

// ============================================================
// 扫描分镜（按 (sceneId, entityName) 对统计引用）
// ============================================================

interface EntityRefStats {
    referencedShotCount: number;
    closeUpShots: number;
}

interface ParsedShot {
    text: string;
    shotType: string;
    entities: string[];
}

function collectEntityReferencesAcrossScenes(store: RenderStratStorage): Map<string, EntityRefStats> {
    const result = new Map<string, EntityRefStats>();

    for (const sceneId of store.designedSceneIds()) {
        const design = store.getShotDesign(sceneId);
        if (!design) continue;

        const stageAlign = store.getStageAlign(sceneId) ?? {};
        const shots = parseAllShots(design);

        for (const shot of shots) {
            const uniqueInShot = new Set<string>();
            for (const localName of shot.entities) {
                const globalName = stageAlign[localName] ?? localName;
                uniqueInShot.add(globalName);
            }
            const isCloseUp = isCloseUpShotType(shot.shotType);
            for (const name of uniqueInShot) {
                const key = `${sceneId}::${name}`;
                const existing = result.get(key) ?? { referencedShotCount: 0, closeUpShots: 0 };
                existing.referencedShotCount += 1;
                if (isCloseUp) existing.closeUpShots += 1;
                result.set(key, existing);
            }
        }
    }

    return result;
}

function parseAllShots(design: string): ParsedShot[] {
    const blocks = design.split(/^###\s+镜头/m).slice(1);
    return blocks.map(block => {
        const text = "镜头" + block;
        return {
            text,
            shotType: pickField(text, "景别"),
            entities: extractEntityReferences(text),
        };
    });
}

function isCloseUpShotType(shotType: string): boolean {
    const s = shotType.toUpperCase();
    return /\b(CU|ECU|MCU)\b/.test(s) || /近景|特写|中近景/.test(shotType);
}

function pickField(text: string, label: string): string {
    const m = text.match(new RegExp(`${label}[：:]\\s*([^\\n｜]+)`));
    return m ? m[1].trim() : "";
}

function extractEntityReferences(text: string): string[] {
    const pattern = /「([^」]+)」/g;
    const found = new Set<string>();
    for (const match of text.matchAll(pattern)) {
        const name = match[1].trim();
        if (name) found.add(name);
    }
    return Array.from(found);
}

// ============================================================
// 按场景隔离的判定
// ============================================================

function decideStrategy(
    _ctx: IRunnerContext,
    sceneId: string,
    e: GlobalEntity,
    referencedShotCount: number,
    _closeUpShots: number,
): EntityRenderDecision {
    const meta = {
        scene_id: sceneId,
        referenced_shot_count: referencedShotCount,
        referenced_scene_count: 1,
        is_static_in_scene: true,
        origin: e.origin,
        source_group: (e as any).source_group,
    };

    if (e.kind === "light") {
        return { name: e.name, kind: e.kind, strategy: "skip", importance: 0, rationale: "光源", ...meta } as any;
    }

    if (e.kind === "prop") {
        if (e.origin !== "scene") {
            if (referencedShotCount >= 1) {
                return {
                    name: e.name, kind: e.kind,
                    strategy: "individual_refsheet",
                    importance: computeImportance(8, referencedShotCount, 1),
                    rationale: `动态道具（origin=${e.origin}）跨 ${referencedShotCount} 镜头，需独立参考图`,
                    ...meta,
                } as any;
            }
            return {
                name: e.name, kind: e.kind,
                strategy: "prompt_only",
                importance: 2,
                rationale: "动态道具未在镜头引用",
                ...meta,
            } as any;
        }
        return {
            name: e.name, kind: e.kind,
            strategy: "prompt_only",
            importance: 3,
            rationale: "场景固有道具融入环境图",
            ...meta,
        } as any;
    }

    if (e.kind === "set") {
        return {
            name: e.name, kind: e.kind,
            strategy: "prompt_only",
            importance: 3,
            rationale: "静态陈设融入环境图",
            ...meta,
        } as any;
    }

    if (e.kind === "character" && e.count === 1 && e.humanoid) {
        if (referencedShotCount >= 1) {
            return {
                name: e.name, kind: e.kind,
                strategy: "individual_refsheet",
                importance: computeImportance(referencedShotCount >= 2 ? 10 : 7, referencedShotCount, 1),
                rationale: `${referencedShotCount} 镜头`,
                ...meta,
            } as any;
        }
        return {
            name: e.name, kind: e.kind,
            strategy: "prompt_only",
            importance: 1,
            rationale: "未在镜头引用",
            ...meta,
        } as any;
    }

    if (e.kind === "character" && e.humanoid) {
        if (referencedShotCount >= 2) {
            const hasUniform = hasUniformDescription(e);
            if (hasUniform) {
                const d: EntityRenderDecision = {
                    name: e.name, kind: e.kind,
                    strategy: "uniform_refsheet",
                    importance: computeImportance(7, referencedShotCount, 1),
                    rationale: `制式服装群体 ${referencedShotCount} 镜头`,
                    ...meta,
                } as any;
                d.uniform_name = `${e.name}制服`;
                return d;
            }
            return {
                name: e.name, kind: e.kind,
                strategy: "group_photo",
                importance: computeImportance(6, referencedShotCount, 1),
                rationale: `无制式服装群体 ${referencedShotCount} 镜头`,
                ...meta,
            } as any;
        }
        return {
            name: e.name, kind: e.kind,
            strategy: "prompt_only",
            importance: 2,
            rationale: "群体单镜头",
            ...meta,
        } as any;
    }

    if (e.kind === "character") {
        if (referencedShotCount >= 2) {
            return {
                name: e.name, kind: e.kind,
                strategy: "individual_refsheet",
                importance: computeImportance(8, referencedShotCount, 1),
                rationale: `非类人 ${referencedShotCount} 镜头`,
                ...meta,
            } as any;
        }
        return {
            name: e.name, kind: e.kind,
            strategy: "prompt_only",
            importance: 3,
            rationale: "单镜头非类人",
            ...meta,
        } as any;
    }

    return {
        name: e.name, kind: e.kind,
        strategy: "prompt_only",
        importance: 2,
        rationale: "兜底",
        ...meta,
    } as any;
}

function hasUniformDescription(e: GlobalEntity): boolean {
    const text = (e.appearance ?? "").toLowerCase();
    return ["披甲", "甲胄", "制服", "统一", "制式", "袍", "披风", "盔甲", "uniform", "armor"]
        .some(k => text.includes(k));
}

function computeImportance(base: number, shots: number, scenes: number): number {
    return Math.max(0, Math.min(10, base + shots * 2 + scenes * 3));
}

function compareImportance(a: EntityRenderDecision, b: EntityRenderDecision): number {
    if (a.referenced_shot_count !== b.referenced_shot_count) return b.referenced_shot_count - a.referenced_shot_count;
    if (a.referenced_scene_count !== b.referenced_scene_count) return b.referenced_scene_count - a.referenced_scene_count;
    return b.importance - a.importance;
}