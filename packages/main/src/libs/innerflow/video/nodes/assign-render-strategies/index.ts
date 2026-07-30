// nodes/assign-render-strategies/index.ts
import { checkExpiry } from "$libs/blueprint/glossary/expiry.js";
import type { IRunnerContext } from "$types/blueprint/context.js";
import type { GlobalEntity } from "../align-entities/types.js";
import type { EntityRenderDecision } from "../design-characters/types.js";
import { RenderStratStorage } from "./storage.js";

const P = "#video:";

/**
 * 渲染策略判定（纯计算）。
 *
 * 核心规则（基于 origin）：
 * - origin="scene" 的 prop/set → 进环境图（prompt_only / environment inline）
 * - origin="character:..." 的 prop（动态道具）：
 *   - 被 ≥1 个镜头引用 → individual_refsheet（保证跨镜头一致性）
 *   - 仅在 stage 列出但 0 镜头引用 → prompt_only
 * - 静态陈设（set）→ prompt_only 或 environment inline
 *
 * 注意：这里不再依赖启发式"是否在 stage 出现"判断动态性——
 * 直接读 entity.origin（在 align-entities Pass A 已经标好）。
 */
export async function assignRenderStrategies(ctx: IRunnerContext): Promise<void> {
    const store = new RenderStratStorage(ctx);
    const entities = store.allGlobalEntities();

    if (!entities.length) {
        ctx.info("[assignRenderStrategies] 无实体，跳过");
        return;
    }

    if (!checkExpiry(ctx, {
        inputKeys: [
            `${P}stage:registry:idx`,
            `${P}shots:idx:scenes`,
            ...entities.map(e => `${P}stage:registry:${e.name}`),
            ...store.designedSceneIds().map(id => `${P}shots:design_${id}`),
            ...store.designedSceneIds().map(id => `${P}state:stage_${id}`),
            ...store.designedSceneIds().map(id => `${P}stage:align:${id}`),
        ],
        outputKeys: entities.map(e => store.decisionKey(e.name)),
    })) {
        ctx.info("[assignRenderStrategies] 所有策略决策仍新鲜，跳过");
        return;
    }

    // 1. 扫描所有分镜
    const sceneRefs = collectEntityReferencesAcrossScenes(store);
    const initialPresence = collectInitialPresence(store);

    // 2. 全局实体判定
    const decisions: EntityRenderDecision[] = [];
    for (const e of entities) {
        const ref = sceneRefs.get(e.name);
        const referencedShotCount = ref?.referencedShotCount ?? 0;
        const referencedSceneCount = ref?.referencedScenes.size ?? 0;
        const isStaticInAnyScene = (initialPresence.get(e.name)?.size ?? 0) > 0;

        const decision = decideStrategy(e, referencedShotCount, referencedSceneCount, isStaticInAnyScene);
        store.saveDecision(decision);
        decisions.push(decision);
    }

    // 3. source_group 提升个体 pass
    const sourceGroupDecisions = decideSourceGroupIndividuals(store, sceneRefs);
    for (const d of sourceGroupDecisions) {
        store.saveDecision(d);
        decisions.push(d);
    }

    decisions.sort(compareImportance);

    ctx.info(`[assignRenderStrategies] 完成，${decisions.length} 个决策`);
    for (const d of decisions) {
        ctx.info(`[assignRenderStrategies]   ${d.name}: ${d.strategy}｜origin=${d.origin}｜shot=${d.referenced_shot_count}｜scenes=${d.referenced_scene_count}`);
    }
}

// ============================================================
// 扫描分镜
// ============================================================

interface EntityRefStats {
    referencedShotCount: number;
    referencedScenes: Set<string>;
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

        const shots = parseAllShots(design);
        for (const shot of shots) {
            const uniqueInShot = new Set<string>();
            for (const localName of shot.entities) {
                const globalName = store.resolveToGlobalName(sceneId, localName);
                uniqueInShot.add(globalName);
            }
            const isCloseUp = isCloseUpShotType(shot.shotType);
            for (const name of uniqueInShot) {
                const existing = result.get(name) ?? {
                    referencedShotCount: 0,
                    referencedScenes: new Set<string>(),
                    closeUpShots: 0,
                };
                existing.referencedShotCount += 1;
                existing.referencedScenes.add(sceneId);
                if (isCloseUp) existing.closeUpShots += 1;
                result.set(name, existing);
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

function collectInitialPresence(store: RenderStratStorage): Map<string, Set<string>> {
    const result = new Map<string, Set<string>>();
    for (const sceneId of store.designedSceneIds()) {
        const stage = store.getStage(sceneId);
        if (!stage) continue;
        const stageAlign = store.getStageAlign(sceneId) ?? {};
        for (const entity of stage.entities) {
            const globalName = stageAlign[entity.name] ?? entity.name;
            const set = result.get(globalName) ?? new Set<string>();
            set.add(sceneId);
            result.set(globalName, set);
        }
    }
    return result;
}

// ============================================================
// source_group 提升个体 pass
// ============================================================

function decideSourceGroupIndividuals(
    store: RenderStratStorage,
    sceneRefs: Map<string, EntityRefStats>,
): EntityRenderDecision[] {
    const decisions: EntityRenderDecision[] = [];
    const processed = new Set<string>();

    for (const sceneId of store.designedSceneIds()) {
        const stage = store.getStage(sceneId);
        if (!stage) continue;

        for (const entity of stage.entities) {
            if (!entity.source_group) continue;
            if (processed.has(entity.name)) continue;
            processed.add(entity.name);

            const ref = sceneRefs.get(entity.name);
            const referencedShotCount = ref?.referencedShotCount ?? 0;
            const closeUpShots = ref?.closeUpShots ?? 0;

            // 有特写镜头 → 独立参考图
            if (closeUpShots >= 1) {
                decisions.push({
                    name: entity.name,
                    kind: entity.kind,
                    strategy: "individual_refsheet",
                    importance: computeImportance(7, referencedShotCount, 1),
                    rationale: `提升个体有 ${closeUpShots} 个特写镜头，需独立参考图`,
                    referenced_shot_count: referencedShotCount,
                    referenced_scene_count: 1,
                    is_static_in_scene: true,
                    source_group: entity.source_group,
                    origin: "scene",
                });
            }
        }
    }

    return decisions;
}

// ============================================================
// 全局实体判定（核心：基于 origin）
// ============================================================

function decideStrategy(
    e: GlobalEntity,
    referencedShotCount: number,
    referencedSceneCount: number,
    isStaticInAnyScene: boolean,
): EntityRenderDecision {
    const meta = {
        referenced_shot_count: referencedShotCount,
        referenced_scene_count: referencedSceneCount,
        is_static_in_scene: isStaticInAnyScene,
        origin: e.origin,
    };

    if (e.kind === "light") {
        return { name: e.name, kind: e.kind, strategy: "skip", importance: 0, rationale: "光源", ...meta };
    }

    // ===== prop 判定（核心改动）=====
    if (e.kind === "prop") {
        if (e.origin !== "scene") {
            // 动态道具（角色带入/持有）—— 只要在镜头中出现就必须有独立参考图
            if (referencedShotCount >= 1) {
                return {
                    name: e.name, kind: e.kind,
                    strategy: "individual_refsheet",
                    importance: computeImportance(8, referencedShotCount, referencedSceneCount),
                    rationale: `动态道具（origin=${e.origin}）跨 ${referencedShotCount} 镜头，需独立参考图保持一致性`,
                    ...meta,
                };
            }
            // 0 镜头引用 → prompt_only（仅在 stage 列出但不出现）
            return {
                name: e.name, kind: e.kind,
                strategy: "prompt_only",
                importance: 2,
                rationale: `动态道具未在镜头引用`,
                ...meta,
            };
        }
        // scene prop → 融入环境图
        return {
            name: e.name, kind: e.kind,
            strategy: "prompt_only",
            importance: 3,
            rationale: "场景固有道具融入环境图",
            ...meta,
        };
    }

    // ===== set 判定 =====
    if (e.kind === "set") {
        if (referencedSceneCount >= 2) {
            return {
                name: e.name, kind: e.kind,
                strategy: "individual_refsheet",
                importance: computeImportance(6, referencedShotCount, referencedSceneCount),
                rationale: "跨场景陈设",
                ...meta,
            };
        }
        return { name: e.name, kind: e.kind, strategy: "prompt_only", importance: 3, rationale: "静态陈设融入环境图", ...meta };
    }

    // ===== character 判定（保留原有逻辑）=====
    if (e.kind === "character" && e.count === 1 && e.humanoid) {
        if (referencedShotCount >= 1) {
            return {
                name: e.name, kind: e.kind,
                strategy: "individual_refsheet",
                importance: computeImportance(referencedShotCount >= 2 ? 10 : 7, referencedShotCount, referencedSceneCount),
                rationale: `${referencedShotCount} 镜头、${referencedSceneCount} 场景`,
                ...meta,
            };
        }
        return { name: e.name, kind: e.kind, strategy: "prompt_only", importance: 1, rationale: "未在镜头引用", ...meta };
    }

    if (e.kind === "character" && e.humanoid) {
        const hasUniform = hasUniformDescription(e);
        if (referencedShotCount >= 2 || referencedSceneCount >= 2) {
            if (hasUniform) {
                const d: EntityRenderDecision = {
                    name: e.name, kind: e.kind,
                    strategy: "uniform_refsheet",
                    importance: computeImportance(7, referencedShotCount, referencedSceneCount),
                    rationale: `制式服装群体 ${referencedShotCount} 镜头`,
                    ...meta,
                };
                d.uniform_name = `${e.name}制服`;
                return d;
            }
            return {
                name: e.name, kind: e.kind,
                strategy: "group_photo",
                importance: computeImportance(6, referencedShotCount, referencedSceneCount),
                rationale: `无制式服装群体 ${referencedShotCount} 镜头，需群体合照`,
                ...meta,
            };
        }
        return { name: e.name, kind: e.kind, strategy: "prompt_only", importance: 2, rationale: "群体单镜头", ...meta };
    }

    if (e.kind === "character") {
        if (referencedShotCount >= 2 || referencedSceneCount >= 2) {
            return {
                name: e.name, kind: e.kind,
                strategy: "individual_refsheet",
                importance: computeImportance(8, referencedShotCount, referencedSceneCount),
                rationale: `非类人 ${referencedShotCount} 镜头`,
                ...meta,
            };
        }
        return { name: e.name, kind: e.kind, strategy: "prompt_only", importance: 3, rationale: "单镜头非类人", ...meta };
    }

    return { name: e.name, kind: e.kind, strategy: "prompt_only", importance: 2, rationale: "兜底", ...meta };
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