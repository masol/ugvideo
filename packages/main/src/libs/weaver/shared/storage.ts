/**
 * weaver · WeaveStorage
 *
 * 统一封装所有 KV 操作。节点侧永不出现裸 key，永不感知层级。
 * 所有 key 前缀：#weave:
 *
 * 【约定】key 形态：
 *   #weave:state:gflow              // 当前编译的 HumanFlow 快照（整体 JSON）
 *   #weave:state:external_inputs    // 外部输入表（按 graphId 分组）
 *   #weave:state:inferences         // 补全记录数组
 *   #weave:state:concept_snapshot   // 概念表快照（用于断点恢复）
 *   #weave:idx:human_flows          // HumanFlow id 列表
 *   #weave:kb:decision:<id>         // 决策 KB 条目
 *   #weave:kb:tool:<toolId>         // 工具 KB 条目
 *   #weave:kb:skill:<skillId>       // skill KB 条目
 *   #weave:vocab:<formal>           // 词汇表条目
 */

import { PrjDB } from '$libs/project/controllers/drizzle/index.js';
import type { IRunnerContext } from '$types/blueprint/context.js';
import type {
    ConceptReference,
    DecisionEntry,
    ExternalInput,
    HumanFlow,
    Inference,
    Skill,
} from './types.js';

const NS = '#weave:';

// ════════════════════════════════════════════════════════════════════
// 序列化基础工具
// ════════════════════════════════════════════════════════════════════

function k(suffix: string): string {
    return `${NS}${suffix}`;
}

/** 深度克隆（去除不可序列化字段） */
function clone<T>(v: T): T {
    return JSON.parse(JSON.stringify(v)) as T;
}

// ════════════════════════════════════════════════════════════════════
// WeaveStorage —— 主类
// ════════════════════════════════════════════════════════════════════

export class WeaveStorage {
    private prjdb: PrjDB;

    constructor(private ctx: IRunnerContext) {
        this.prjdb = PrjDB.ensure(ctx.prj);
    }

    private read<T>(suffix: string): T | null {
        return this.prjdb.get<T>(k(suffix)) ?? null;
    }

    private write<T>(suffix: string, value: T): void {
        this.prjdb.set(k(suffix), clone(value));
    }

    // ────────────────────────────────────────────────────────────────
    // HumanFlow 快照
    // ────────────────────────────────────────────────────────────────

    saveHumanFlow(flow: HumanFlow): void {
        const snapshot = {
            ...flow,
            g: undefined,
        };
        this.write(`state:gflow:${flow.id}`, snapshot);
        this.addToIndex('idx:human_flows', flow.id);
    }

    getHumanFlow(id: string): HumanFlow | null {
        const snap = this.read<HumanFlow>(`state:gflow:${id}`);
        return snap ?? null;
    }

    listHumanFlowIds(): string[] {
        return this.read<string[]>('idx:human_flows') ?? [];
    }

    listHumanFlows(): HumanFlow[] {
        return this.listHumanFlowIds()
            .map(id => this.getHumanFlow(id))
            .filter((f): f is HumanFlow => f !== null);
    }

    private addToIndex(idxKey: string, id: string): void {
        const list = this.read<string[]>(idxKey) ?? [];
        if (!list.includes(id)) {
            this.write(idxKey, [...list, id]);
        }
    }

    // ────────────────────────────────────────────────────────────────
    // 外部输入表
    // ────────────────────────────────────────────────────────────────

    saveExternalInputs(graphId: string, inputs: ExternalInput[]): void {
        const map = this.read<Record<string, ExternalInput[]>>('state:external_inputs') ?? {};
        map[graphId] = inputs;
        this.write('state:external_inputs', map);
    }

    getExternalInputs(graphId: string): ExternalInput[] {
        const map = this.read<Record<string, ExternalInput[]>>('state:external_inputs') ?? {};
        return map[graphId] ?? [];
    }

    // ────────────────────────────────────────────────────────────────
    // 补全记录
    // ────────────────────────────────────────────────────────────────

    saveInferences(inferences: Inference[]): void {
        this.write('state:inferences', inferences);
    }

    getInferences(): Inference[] {
        return this.read<Inference[]>('state:inferences') ?? [];
    }

    // ────────────────────────────────────────────────────────────────
    // 概念表快照
    // ────────────────────────────────────────────────────────────────

    saveConceptTable(concepts: ConceptReference[]): void {
        this.write('state:concept_snapshot', concepts);
    }

    getConceptTable(): ConceptReference[] {
        return this.read<ConceptReference[]>('state:concept_snapshot') ?? [];
    }

    // ────────────────────────────────────────────────────────────────
    // 决策 KB
    // ────────────────────────────────────────────────────────────────

    saveDecisionEntry(entry: DecisionEntry): void {
        this.write(`kb:decision:${entry.id}`, entry);
    }

    getDecisionEntry(id: string): DecisionEntry | null {
        return this.read<DecisionEntry>(`kb:decision:${id}`);
    }

    listDecisionEntries(domain?: string): DecisionEntry[] {
        const all = this.read<DecisionEntry[]>('idx:decision_entries') ?? [];
        return domain ? all.filter(e => e.domain === domain) : all;
    }

    indexDecisionEntry(id: string): void {
        const list = this.read<string[]>('idx:decision_entries') ?? [];
        if (!list.includes(id)) {
            this.write('idx:decision_entries', [...list, id]);
        }
    }

    supersedeDecisionEntry(oldId: string, newId: string): void {
        const entry = this.getDecisionEntry(oldId);
        if (entry) {
            entry.supersededBy = newId;
            entry.updatedAt = Date.now();
            this.write(`kb:decision:${oldId}`, entry);
        }
    }

    // ────────────────────────────────────────────────────────────────
    // 工具 KB
    // ────────────────────────────────────────────────────────────────

    saveTool(toolId: string, tool: { name: string; description: string; keywords: string[] }): void {
        this.write(`kb:tool:${toolId}`, tool);
        const list = this.read<string[]>('idx:tools') ?? [];
        if (!list.includes(toolId)) {
            this.write('idx:tools', [...list, toolId]);
        }
    }

    getTool(toolId: string): { name: string; description: string; keywords: string[] } | null {
        return this.read<{ name: string; description: string; keywords: string[] }>(`kb:tool:${toolId}`);
    }

    listToolIds(): string[] {
        return this.read<string[]>('idx:tools') ?? [];
    }

    // ────────────────────────────────────────────────────────────────
    // Skill KB
    // ────────────────────────────────────────────────────────────────

    saveSkill(skill: Skill): void {
        this.write(`kb:skill:${skill.id}`, skill);
        const list = this.read<string[]>('idx:skills') ?? [];
        if (!list.includes(skill.id)) {
            this.write('idx:skills', [...list, skill.id]);
        }
    }

    getSkill(id: string): Skill | null {
        return this.read<Skill>(`kb:skill:${id}`);
    }

    listSkillIds(): string[] {
        return this.read<string[]>('idx:skills') ?? [];
    }

    // ────────────────────────────────────────────────────────────────
    // 词汇表
    // ────────────────────────────────────────────────────────────────

    saveVocabEntry(formalName: string, aliases: string[]): void {
        this.write(`vocab:${formalName}`, aliases);
    }

    getVocabEntry(formalName: string): string[] | null {
        return this.read<string[]>(`vocab:${formalName}`);
    }

    listVocabFormals(): string[] {
        return this.read<string[]>('idx:vocab') ?? [];
    }

    indexVocab(formalName: string): void {
        const list = this.read<string[]>('idx:vocab') ?? [];
        if (!list.includes(formalName)) {
            this.write('idx:vocab', [...list, formalName]);
        }
    }

    // ────────────────────────────────────────────────────────────────
    // 清理
    // ────────────────────────────────────────────────────────────────

    clearHumanFlow(id: string): void {
        this.prjdb.remove(k(`state:gflow:${id}`));
        const list = this.read<string[]>('idx:human_flows') ?? [];
        this.write('idx:human_flows', list.filter(x => x !== id));
    }

    clearAll(): void {
        this.prjdb.removeByGlob(NS);
    }
}