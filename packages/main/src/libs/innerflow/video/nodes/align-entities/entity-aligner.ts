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

const TIME_SKIP_KEYWORDS = /次日|翌日|数日后|数月后|数年后|多年后|翌日清晨|第二天|三天后|一周后|一月后|一年后|多年后/i;
const SAME_LOCATION_KEYWORDS = /同一|同一地点|同一场景/i;

export async function alignAllScenes(ctx: IRunnerContext, sceneIds: string[]): Promise<void> {
    const store = new Storage(ctx);

    // 修复：收集"本次是否有任何场景被新对齐"的信号。
    // 只有真正重写了 align 的场景才触发后续的审计 + 时间跳跃扫描。
    let anyAlignChanged = false;
    for (const sceneId of sceneIds) {
        const changed = await alignScene(ctx, sceneId);
        if (changed) anyAlignChanged = true;
    }

    ctx.info(`[alignAllScenes] 逐场景对齐完成（本次变化：${anyAlignChanged}）`);

    if (!anyAlignChanged) {
        // 没有任何场景被重新对齐 → registry 无变化 → 审计和 time_skips 都不会有变化，直接跳过
        ctx.info(`[alignAllScenes] 无对齐变化，跳过审计与时间跳跃扫描`);
        return;
    }

    // 有变化才执行审计 + 时间跳跃扫描
    for (let round = 1; round <= MAX_AUDIT_ROUNDS; round++) {
        const hasIssues = await auditRegistry(ctx, round);
        if (!hasIssues) {
            ctx.info(`[alignAllScenes] 登记册审计通过（第${round}轮）`);
            break;
        }
        if (round === MAX_AUDIT_ROUNDS) {
            ctx.warn(`[alignAllScenes] 达到最大审计轮次 ${MAX_AUDIT_ROUNDS}，仍有问题，继续`);
        }
    }

    scanTimeSkips(ctx, store, sceneIds);
    ctx.info(`[alignAllScenes] 时间跳跃标记完成`);
}

function scanTimeSkips(
    ctx: IRunnerContext,
    store: Storage,
    sceneIds: string[],
): void {
    const sceneMetaMap = new Map<string, ReturnType<typeof store.getSceneMeta>>();
    for (const id of sceneIds) {
        sceneMetaMap.set(id, store.getSceneMeta(id));
    }

    const entityScenesMeta = new Map<string, Array<{
        sceneId: string;
        episode?: string;
        act?: string;
        location?: string;
        timeOfDay?: string;
        alignedText?: string;
    }>>();

    for (const e of store.allGlobalEntities()) {
        if (e.kind === "set" || e.kind === "light") continue;
        const seq: Array<{ sceneId: string; episode?: string; act?: string; location?: string; timeOfDay?: string; alignedText?: string }> = [];
        for (const sid of e.scenes) {
            const meta = store.getSceneMeta(sid);
            const episodeAct = parseEpisodeAct(meta);
            const location = parseField(meta, "地点");
            const time = parseField(meta, "时间");
            const alignedText = store.getAlignedText(sid) ?? "";
            seq.push({
                sceneId: sid,
                episode: episodeAct.episode,
                act: episodeAct.act,
                location,
                timeOfDay: time,
                alignedText: alignedText.slice(0, 500),
            });
        }
        entityScenesMeta.set(e.name, seq);
    }

    for (const [name, seq] of entityScenesMeta) {
        for (let i = 0; i < seq.length; i++) {
            if (i === 0) {
                store.markTimeSkip(name, seq[i].sceneId, false);
                continue;
            }
            const prev = seq[i - 1];
            const cur = seq[i];

            let isSkip = false;

            if (cur.episode && prev.episode && cur.episode !== prev.episode) {
                isSkip = true;
            } else if (cur.act && prev.act && cur.act !== prev.act) {
                isSkip = true;
            } else if (cur.location && prev.location && cur.location !== prev.location) {
                isSkip = true;
            } else if (TIME_SKIP_KEYWORDS.test(cur.alignedText ?? "")) {
                isSkip = true;
            } else if (SAME_LOCATION_KEYWORDS.test(cur.alignedText ?? "")) {
                isSkip = false;
            }

            store.markTimeSkip(name, cur.sceneId, isSkip);
            if (isSkip) {
                ctx.info(`[scanTimeSkips] ${name}@${cur.sceneId}: 时间跳跃（vs ${prev.sceneId}）`);
            }
        }
    }
}

function parseEpisodeAct(meta: string | null): { episode?: string; act?: string } {
    if (!meta) return {};
    const episode = parseField(meta, "集");
    const act = parseField(meta, "幕");
    return { episode, act };
}

function parseField(meta: string | null, label: string): string | undefined {
    if (!meta) return undefined;
    const m = meta.match(new RegExp(`${label}：([^\\n]+)`));
    return m ? m[1].trim() : undefined;
}

/**
 * 单场景对齐。
 * 返回 true 表示本次真正执行了重写，false 表示被 checkExpiry 跳过。
 */
async function alignScene(ctx: IRunnerContext, sceneId: string): Promise<boolean> {
    const store = new Storage(ctx);

    if (!checkExpiry(ctx, {
        inputKeys: store.stageKey(sceneId),
        outputKeys: store.alignKey(sceneId),
    })) {
        ctx.info(`[alignScene] ${sceneId} 对齐仍新鲜，跳过`);
        return false;
    }

    const stage = store.getStage(sceneId);
    if (!stage) return false;

    const mapping: Record<string, string> = {};
    let counted = 0;

    // 修复：worn_by 道具（穿在某角色身上的衣物/配饰）不参与登记册、不参与决策。
    // 这些道具的视觉表现由该角色的定妆照覆盖，外观特征在 Pass B / design-characters 阶段
    // 会以角色 scene_delta 的形式合并；这里只收集其原文描述并附加到对应角色的 stage
    // worn_props 备注中，供下游读取合并。
    const wornPropsByCharacter = new Map<string, Array<{ name: string; appearance: string }>>();

    for (const entity of stage.entities) {
        const name = (entity.name ?? "").trim();
        if (!name) {
            ctx.warn(`[alignScene] ${sceneId} 实体名称缺失，跳过`);
            continue;
        }

        // ===== 修复：穿着道具剥离 =====
        if (entity.kind === "prop" && entity.worn_by) {
            const wearerName = entity.worn_by.trim();
            if (!mapping[wearerName]) {
                // 角色名在本场景尚未对齐（罕见的 roster 顺序异常），记录警告并跳过本条
                ctx.warn(`[alignScene] ${sceneId} 穿着道具 "${name}" 的穿着者 "${wearerName}" 未对齐，跳过合并`);
            } else {
                const list = wornPropsByCharacter.get(wearerName) ?? [];
                list.push({ name, appearance: entity.appearance ?? "" });
                wornPropsByCharacter.set(wearerName, list);
                ctx.info(`[alignScene] ${sceneId} 穿着道具剥离："${name}" → "${wearerName}" 角色 scene_delta`);
            }
            continue;
        }

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

        const candidateName = findFuzzyCandidate(store, bareName);

        if (candidateName) {
            const existingByCandidate = store.getGlobalEntity(candidateName)!;
            if (isMergeCompatible(existingByCandidate, entity)) {
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
            } else {
                ctx.info(`[alignScene] ${sceneId} 模糊命中但类别/类人不兼容，判为不同："${name}" vs "${candidateName}"`);
            }
        }

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

    // ===== 修复：把穿着道具的原文特征写到 stage 上，供下游合并 =====
    if (wornPropsByCharacter.size > 0) {
        store.saveWornProps(sceneId, wornPropsByCharacter);
        ctx.info(`[alignScene] ${sceneId} 穿着道具合并：${wornPropsByCharacter.size} 个角色受益`);
    }

    store.saveStageAlign(sceneId, mapping);
    ctx.info(`[alignScene] ${sceneId} 对齐完成，${counted} 个实体`);
    return true;
}

function isMergeCompatible(a: { kind: string; humanoid?: boolean }, b: { kind: string; humanoid?: boolean }): boolean {
    if (a.kind !== b.kind) return false;
    if (a.kind === "character" && (a.humanoid ?? false) !== (b.humanoid ?? false)) return false;
    return true;
}

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

async function auditRegistry(ctx: IRunnerContext, round: number): Promise<boolean> {
    const store = new Storage(ctx);
    const entities = store.allGlobalEntities();
    if (entities.length === 0) return false;

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
        const actionHint = aligned ? aligned.slice(0, 80).replace(/\s+/g, " ").trim() : "";

        for (const [entityName] of mapOfEntityScenes(store, sceneId)) {
            const list = map.get(entityName) ?? [];
            list.push(actionHint
                ? `${sceneId}（${summary}）｜行为线索：${actionHint}`
                : `${sceneId}（${summary}）`);
            map.set(entityName, list);
        }
    }
    return map;
}

function mapOfEntityScenes(_store: Storage, _sceneId: string): Map<string, string[]> {
    return _collectEntitiesInScene(_store, _sceneId);
}

function _collectEntitiesInScene(store: Storage, sceneId: string): Map<string, string[]> {
    const result = new Map<string, string[]>();
    const stage = store.getStage(sceneId);
    if (!stage) return result;
    for (const e of stage.entities) {
        // 修复：worn_by 实体不入 scene 摘要（不参与决策，不参与审计）
        if (e.source_group) continue;
        if (e.kind === "prop" && e.worn_by) continue;
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

        if (e.time_skips && Object.values(e.time_skips).some(v => v)) {
            const skipScenes = Object.entries(e.time_skips).filter(([, v]) => v).map(([k]) => k);
            lines.push(`  时间跳跃场景：${skipScenes.join("、")}（这些场景可能需要换装/衰老）`);
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

    const otherEntries = entries.filter(e => e !== target);

    for (const other of otherEntries) {
        const otherEntity = store.getGlobalEntity(other);
        if (!otherEntity) continue;
        if (!isMergeCompatible(targetEntity, otherEntity)) {
            ctx.warn(
                `[doMerge] 拒绝不兼容合并："${other}"（${otherEntity.kind}/${otherEntity.humanoid ? "类人" : "非类人"}）`
                + ` → "${target}"（${targetEntity.kind}/${targetEntity.humanoid ? "类人" : "非类人"}）`,
            );
            return false;
        }
    }

    const allSceneIds = new Set<string>(targetEntity.scenes);

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