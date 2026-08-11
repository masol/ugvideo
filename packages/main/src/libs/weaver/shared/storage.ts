/**
 * weaver · WeaveStorage
 *
 * 统一封装所有 KV 操作。所有 key 前缀：#weave:
 *
 * 约定 key 形态：
 *   #weave:state:gflow:<flowId>           // HumanFlow 快照
 *   #weave:state:standard_doc             // 解析后的 StandardFlowDoc
 *   #weave:state:external_inputs          // 外部输入表
 *   #weave:state:inferences               // 补全记录
 *   #weave:state:concept_snapshot         // 概念表快照
 *   #weave:state:macro_info               // LLM 收集的宏观信息
 *   #weave:state:step_outputs             // LLM 识别的步骤输出
 *   #weave:state:atom_actions             // 拆解后的原子动作
 *   #weave:state:vocab_alignment          // 词汇对齐表
 *   #weave:idx:human_flows                // HumanFlow id 列表
 *   #weave:kb:decision:<id>               // 决策 KB
 *   #weave:kb:tool:<toolId>               // 工具 KB
 *   #weave:kb:skill:<skillId>             // skill KB
 *   #weave:vocab:<formal>                 // 词汇表
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
    StandardFlowDoc,
} from './types.js';

const NS = '#weave:';

function k(suffix: string): string {
    return `${NS}${suffix}`;
}

function clone<T>(v: T): T {
    return JSON.parse(JSON.stringify(v)) as T;
}

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
    // HumanFlow
    // ────────────────────────────────────────────────────────────────

    saveHumanFlow(flow: HumanFlow): void {
        const snapshot = { ...flow, g: undefined };
        this.write(`state:gflow:${flow.id}`, snapshot);
        this.addToIndex('idx:human_flows', flow.id);
    }

    getHumanFlow(id: string): HumanFlow | null {
        return this.read<HumanFlow>(`state:gflow:${id}`);
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
    // 标准格式文档
    // ────────────────────────────────────────────────────────────────

    saveStandardDoc(doc: StandardFlowDoc): void {
        this.write('state:standard_doc', doc);
    }

    getStandardDoc(): StandardFlowDoc | null {
        return this.read<StandardFlowDoc>('state:standard_doc');
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
    // 阶段产物
    // ────────────────────────────────────────────────────────────────

    saveMacroInfo(info: string): void {
        this.write('state:macro_info', info);
    }

    getMacroInfo(): string | null {
        return this.read<string>('state:macro_info');
    }

    saveStepOutputs(text: string): void {
        this.write('state:step_outputs', text);
    }

    getStepOutputs(): string | null {
        return this.read<string>('state:step_outputs');
    }

    saveAtomActions(text: string): void {
        this.write('state:atom_actions', text);
    }

    getAtomActions(): string | null {
        return this.read<string>('state:atom_actions');
    }

    saveVocabAlignment(text: string): void {
        this.write('state:vocab_alignment', text);
    }

    getVocabAlignment(): string | null {
        return this.read<string>('state:vocab_alignment');
    }

    // ────────────────────────────────────────────────────────────────
    // 决策 KB
    // ────────────────────────────────────────────────────────────────

    saveDecisionEntry(entry: DecisionEntry): void {
        this.write(`kb:decision:${entry.id}`, entry);
        this.addToIndex('idx:decision_entries', entry.id);
    }

    getDecisionEntry(id: string): DecisionEntry | null {
        return this.read<DecisionEntry>(`kb:decision:${id}`);
    }

    listDecisionEntries(domain?: string): DecisionEntry[] {
        const all = this.read<DecisionEntry[]>('idx:decision_entries') ?? [];
        return domain ? all.filter(e => e.domain === domain) : all;
    }

    indexDecisionEntry(id: string): void {
        this.addToIndex('idx:decision_entries', id);
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
    // 工具 / Skill KB
    // ────────────────────────────────────────────────────────────────

    saveTool(toolId: string, tool: { name: string; description: string; keywords: string[] }): void {
        this.write(`kb:tool:${toolId}`, tool);
        this.addToIndex('idx:tools', toolId);
    }

    getTool(toolId: string): { name: string; description: string; keywords: string[] } | null {
        return this.read<{ name: string; description: string; keywords: string[] }>(`kb:tool:${toolId}`);
    }

    listToolIds(): string[] {
        return this.read<string[]>('idx:tools') ?? [];
    }

    saveSkill(skill: Skill): void {
        this.write(`kb:skill:${skill.id}`, skill);
        this.addToIndex('idx:skills', skill.id);
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
        this.addToIndex('idx:vocab', formalName);
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