// nodes/align-entities/entity-aligner.ts
import { checkExpiry } from "$libs/blueprint/glossary/expiry.js";
import { getSmartModel } from "$libs/model/balancer/get-smart-model.js";
import type { IRunnerContext } from "$types/blueprint/context.js";
import { generateText } from "ai";
import Fuse from "fuse.js";
import { ENTITY_ALIGNER_PROMPT } from "./prompts/entity-aligner.js";
import { REGISTRY_AUDITOR_PROMPT } from "./prompts/registry-auditor.js";
import { Storage } from "./storage.js";
import type { GlobalEntity, StageEntity } from "./types.js";

const SCRIPT_SUFFIXES = /[\s·\-_]*(OS|VO|V\.?O\.?|OC|旁白|画外音|内心|独白|O\.S\.|O\.C\.)$/i;

function stripScriptSuffix(name: string): string {
    return name.replace(SCRIPT_SUFFIXES, "").trim();
}

const FUSE_THRESHOLD = 0.2;
const MAX_AUDIT_ROUNDS = 2;
const P = "#video:";

// ============================================================
// Pass D 主入口：逐场景对齐 + 反向审计 ReAct
// ============================================================

export async function alignAllScenes(ctx: IRunnerContext, sceneIds: string[]): Promise<void> {
    const store = new Storage(ctx);

    // 逐场景串行对齐
    for (const sceneId of sceneIds) {
        await alignScene(ctx, sceneId);
    }

    ctx.info(`[alignAllScenes] 逐场景对齐完成，开始登记册审计`);

    // 反向审计 ReAct 循环
    for (let round = 1; round <= MAX_AUDIT_ROUNDS; round++) {
        const auditInputKeys = [
            `${P}stage:registry:idx`,
            ...sceneIds.map(id => store.alignKey(id)),
        ];

        if (!checkExpiry(ctx, {
            inputKeys: auditInputKeys,
            outputKeys: `${P}stage:registry:idx`,
        })) {
            ctx.info(`[alignAllScenes] 登记册审计仍新鲜，跳过第${round}轮`);
            break;
        }

        const hasIssues = await auditRegistry(ctx, round);
        if (!hasIssues) {
            ctx.info(`[alignAllScenes] 登记册审计通过（第${round}轮）`);
            break;
        }
        if (round === MAX_AUDIT_ROUNDS) {
            ctx.warn(`[alignAllScenes] 达到最大审计轮次 ${MAX_AUDIT_ROUNDS}，仍有问题，继续`);
        }
    }
}

// ============================================================
// 单场景对齐
// ============================================================

async function alignScene(ctx: IRunnerContext, sceneId: string): Promise<void> {
    const store = new Storage(ctx);

    if (!checkExpiry(ctx, {
        inputKeys: store.stageKey(sceneId),
        outputKeys: store.alignKey(sceneId),
    })) {
        ctx.info(`[alignScene] ${sceneId} 对齐仍新鲜，跳过`);
        return;
    }

    const stage = store.getStage(sceneId);
    if (!stage) return;

    const mapping: Record<string, string> = {};
    let counted = 0;

    for (const entity of stage.entities) {
        const name = (entity.name ?? "").trim();
        if (!name) {
            ctx.warn(`[alignScene] ${sceneId} 实体名称缺失，跳过`);
            continue;
        }

        // 群体提升个体：不进全局登记册，不参与跨场景身份对齐。
        // 仅在场景静态舞台表里有视觉描述，design-shots 为其产出独立素材。
        // 在镜头提示词中以 inlineForShot 文字渲染，无需定妆照。
        if (entity.source_group) {
            mapping[name] = name;
            counted++;
            continue;
        }

        if (entity.kind === "light") {
            mapping[name] = name;
            counted++;
            continue;
        }

        const bareName = stripScriptSuffix(name);

        // 精确匹配（裸名比对）
        const exactMatch = findExactByBareName(store, bareName);
        if (exactMatch) {
            store.addSceneToEntity(exactMatch, sceneId);
            mapping[name] = exactMatch;
            counted++;
            if (name !== exactMatch) {
                ctx.info(`[alignScene] ${sceneId} 后缀剥离命中："${name}" → "${exactMatch}"`);
            }
            continue;
        }

        // 模糊匹配
        const candidateName = findFuzzyCandidate(store, bareName);

        if (candidateName) {
            const existingByCandidate = store.getGlobalEntity(candidateName)!;
            const same = await verifySameEntity(
                ctx,
                existingByCandidate,
                entity,
                sceneId,
                candidateName,
            );
            if (same) {
                store.addSceneToEntity(candidateName, sceneId);
                mapping[name] = candidateName;
                counted++;
                ctx.info(`[alignScene] ${sceneId} 模糊命中："${name}" → "${candidateName}"`);
                continue;
            }
            // LLM 判定为不同 → 新建
        }

        // 新建：用裸名作为规范名
        const canonicalName = bareName || name;
        store.upsertGlobalEntity({
            name: canonicalName,
            kind: entity.kind,
            appearance: entity.appearance ?? "",
            scenes: [sceneId],
            humanoid: entity.humanoid,
            count: entity.count,
            origin: entity.origin ?? "scene",
        });
        mapping[name] = canonicalName;
        counted++;
    }

    store.saveStageAlign(sceneId, mapping);
    ctx.info(`[alignScene] ${sceneId} 对齐完成，${counted} 个实体`);
}

// ============================================================
// 匹配辅助函数
// ============================================================

function findExactByBareName(store: Storage, bareName: string): string | null {
    if (!bareName) return null;
    const existingNames = store.entityNames();
    for (const registered of existingNames) {
        if (stripScriptSuffix(registered) === bareName) return registered;
    }
    return null;
}

function findFuzzyCandidate(store: Storage, bareName: string): string | null {
    const existingNames = store.entityNames();
    if (existingNames.length === 0 || !bareName) return null;

    const bareToOriginal = new Map<string, string>();
    const bareNames: string[] = [];
    for (const n of existingNames) {
        const bare = stripScriptSuffix(n);
        bareToOriginal.set(bare, n);
        bareNames.push(bare);
    }

    const fuse = new Fuse(bareNames, {
        includeScore: true,
        threshold: 1 - FUSE_THRESHOLD,
    });
    const results = fuse.search(bareName);
    if (results.length === 0) return null;

    const best = results[0];
    const similarity = 1 - (best.score ?? 1);
    if (similarity < FUSE_THRESHOLD) return null;

    return bareToOriginal.get(best.item) ?? null;
}

async function verifySameEntity(
    ctx: IRunnerContext,
    known: GlobalEntity,
    incoming: StageEntity,
    incomingScene: string,
    knownName: string,
): Promise<boolean> {
    const incomingName = (incoming.name ?? "").trim();
    if (!incomingName) return true;
    if (!Array.isArray(known.scenes)) return true;

    const { text } = await generateText({
        model: getSmartModel(undefined, ctx),
        system: ENTITY_ALIGNER_PROMPT.system,
        prompt: ENTITY_ALIGNER_PROMPT.user(
            `${knownName} ⇄ ${stripScriptSuffix(incomingName)}`,
            incoming.kind,
            known.appearance || "（原文无外观描写）",
            known.scenes.join("、"),
            incoming.appearance || "（原文无外观描写）",
            incomingScene,
        ),
    });

    return parseSameVerdict(text);
}

function parseSameVerdict(text: string): boolean {
    const lines = text.trim().split(/\n+/).map(l => l.trim()).filter(Boolean);
    if (lines.length === 0) return true;
    const last = lines[lines.length - 1].toUpperCase();
    if (/\bSAME\b/.test(last) && !/\bDIFFERENT\b/.test(last)) return true;
    if (/\bDIFFERENT\b/.test(last)) return false;
    return true;
}

// ============================================================
// 登记册反向审计（ReAct）
// ============================================================

async function auditRegistry(ctx: IRunnerContext, round: number): Promise<boolean> {
    const store = new Storage(ctx);
    const entities = store.allGlobalEntities();
    if (entities.length === 0) return false;

    // 收集每个实体的场景语义摘要（用于审计消歧）
    const sceneSummaries = collectSceneSummaries(store);

    const registryText = renderRegistryForAudit(entities, sceneSummaries);

    const { text } = await generateText({
        model: getSmartModel(undefined, ctx),
        instructions: REGISTRY_AUDITOR_PROMPT.system,
        prompt: REGISTRY_AUDITOR_PROMPT.user(registryText),
    });

    if (parseAuditVerdict(text) === "PASS") {
        return false;
    }

    ctx.info(`[auditRegistry] 第${round}轮发现问题，开始修正`);
    const issues = parseAuditIssues(text);

    let fixedCount = 0;
    for (const issue of issues) {
        if (issue.type === "merge") {
            if (doMerge(ctx, store, issue.entries, issue.target ?? "")) fixedCount++;
        } else if (issue.type === "split") {
            if (doSplit(ctx, store, issue.entries)) fixedCount++;
        }
    }

    ctx.info(`[auditRegistry] 第${round}轮修正完成，处理 ${fixedCount}/${issues.length} 项`);
    return fixedCount > 0 || issues.length > 0;
}

/**
 * 收集每个实体在每个出场场景的语义摘要（场景元信息 + 首行摘要）。
 * 用于审计 prompt 注入，帮助消歧。
 */
function collectSceneSummaries(store: Storage): Map<string, string[]> {
    const map = new Map<string, string[]>();
    for (const sceneId of store.sceneIds()) {
        const meta = store.getSceneMeta(sceneId);
        if (!meta) continue;
        const firstLineMatch = meta.match(/概述：(.+)/);
        const locationMatch = meta.match(/地点：(.+)/);
        const timeMatch = meta.match(/时间：(.+)/);
        const parts: string[] = [];
        if (locationMatch) parts.push(`地点：${locationMatch[1].trim()}`);
        if (timeMatch) parts.push(`时间：${timeMatch[1].trim()}`);
        if (firstLineMatch) parts.push(`首行：${firstLineMatch[1].trim()}`);
        const summary = parts.length > 0 ? parts.join("；") : "（无元信息）";

        const aligned = store.getAlignedText(sceneId);
        // 从对齐后原文取前 80 字作为行为线索
        const actionHint = aligned ? aligned.slice(0, 80).replace(/\s+/g, " ").trim() : "";

        for (const [entityName, scenes] of mapOfEntityScenes(store, sceneId)) {
            void (scenes)
            const list = map.get(entityName) ?? [];
            list.push(actionHint
                ? `${sceneId}（${summary}）｜行为线索：${actionHint}`
                : `${sceneId}（${summary}）`);
            map.set(entityName, list);
        }
    }
    return map;
}

/**
 * 返回本场景内有该实体引用的实体名集合（简化：从 align 映射反查）。
 */
function mapOfEntityScenes(_store: Storage, _sceneId: string): Map<string, string[]> {
    // 实际实现：从 stage.entities 与对齐后文本中提取。
    // 此处给出最简形式：返回空 map，由 renderRegistryForAudit 兜底不显示场景行为。
    // 真实数据从 stage 提取更准，这里改为直接读 stage：
    return _collectEntitiesInScene(_store, _sceneId);
}

function _collectEntitiesInScene(store: Storage, sceneId: string): Map<string, string[]> {
    const result = new Map<string, string[]>();
    const stage = store.getStage(sceneId);
    if (!stage) return result;
    for (const e of stage.entities) {
        if (e.source_group) continue; // 提升个体不参与全局表审计
        const globalName = store.getStageAlign(sceneId)?.[e.name] ?? e.name;
        result.set(globalName, [sceneId]);
    }
    return result;
}

function renderRegistryForAudit(entities: GlobalEntity[], sceneSummaries: Map<string, string[]>): string {
    const lines: string[] = [];
    for (const e of entities) {
        const name = e.name || "（无名）";
        const countLabel = e.count === 0 ? "群体" : e.count === 1 ? "个体" : `${e.count}个`;
        const humanoidLabel = e.kind === "character" ? (e.humanoid ? "类人" : "非类人") : "—";
        lines.push(`- ${name}（${e.kind}｜${countLabel}｜${humanoidLabel}）`);
        lines.push(`  首次外观：${e.appearance || "无"}`);

        const summaries = sceneSummaries.get(name);
        if (summaries && summaries.length > 0) {
            lines.push(`  场景语义（每场的行为线索）：`);
            for (const s of summaries) {
                lines.push(`    · ${s}`);
            }
        } else {
            lines.push(`  场景语义：（无）`);
        }
    }
    return lines.join("\n");
}

type AuditIssue = {
    type: "merge" | "split";
    entries: string[];
    target?: string;
};

function parseAuditVerdict(text: string): "PASS" | "ISSUES" {
    const lastLine = text.trim().split(/\n+/).filter(Boolean).pop() ?? "";
    return /\bPASS\b/.test(lastLine.toUpperCase()) ? "PASS" : "ISSUES";
}

function parseAuditIssues(text: string): AuditIssue[] {
    const issues: AuditIssue[] = [];
    const blocks = text.split(/^##\s+/m).slice(1);
    for (const block of blocks) {
        const lines = block.split("\n");
        const typeLine = lines.find(l => /类型：/.test(l)) ?? "";
        const entryLine = lines.find(l => /条目：/.test(l)) ?? "";
        const targetLine = lines.find(l => /建议：/.test(l)) ?? "";

        if (/类型：A/.test(typeLine)) {
            const entries = parseNamesFromLine(entryLine);
            const targetMatch = targetLine.match(/合并为\s*(.+)/);
            if (entries.length >= 2 && targetMatch) {
                issues.push({
                    type: "merge",
                    entries,
                    target: targetMatch[1].trim(),
                });
            }
        } else if (/类型：B/.test(typeLine)) {
            const entries = parseNamesFromLine(entryLine);
            if (entries.length >= 1) {
                issues.push({
                    type: "split",
                    entries,
                });
            }
        }
    }
    return issues;
}

function parseNamesFromLine(line: string): string[] {
    const matches = line.match(/[「[【]([^「\]】\]]+)[」\]】]/g) ?? [];
    return matches.map(m => m.replace(/[「[【」\]】]/g, "").trim()).filter(Boolean);
}

function doMerge(ctx: IRunnerContext, store: Storage, entries: string[], target: string): boolean {
    if (entries.length < 2 || !target) return false;

    const targetEntity = store.getGlobalEntity(target);
    if (!targetEntity) {
        ctx.warn(`[doMerge] 目标实体不存在：${target}`);
        return false;
    }

    const allSceneIds = new Set<string>(targetEntity.scenes);
    const otherEntries = entries.filter(e => e !== target);

    for (const other of otherEntries) {
        const otherEntity = store.getGlobalEntity(other);
        if (!otherEntity) continue;

        for (const sid of otherEntity.scenes) allSceneIds.add(sid);

        store.removeGlobalEntity(other);
        store.renameInAllAligns(other, target);
    }

    store.upsertGlobalEntity({
        ...targetEntity,
        scenes: Array.from(allSceneIds).sort(),
    });

    ctx.info(`[doMerge] 合并 ${entries.join("+")} → ${target}（共 ${allSceneIds.size} 个场景）`);
    return true;
}

function doSplit(ctx: IRunnerContext, store: Storage, entries: string[]): boolean {
    if (entries.length === 0) return false;
    const target = entries[0];
    const entity = store.getGlobalEntity(target);
    if (!entity) return false;

    store.removeGlobalEntity(target);
    ctx.info(`[doSplit] 拆分 ${target}（相关场景将在下次对齐时重新识别）`);
    return true;
}