/**
 * weaver · Storage 聚合入口
 */

import { getInput } from '$libs/blueprint/glossary/input.js';
import { PrjDB } from '$libs/project/controllers/drizzle/index.js';
import type { IRunnerContext } from '$types/blueprint/context.js';
import { parseWeaveTarget, type WeaveConfig, type WeaveTarget } from '../types.js';
import { ConceptStorage } from './concept.js';
import { DecisionStorage } from './decision.js';
import { VocabStorage } from './vocab.js';
import { WorkflowStorage } from './workflow.js';

export class WeaveStorage {
    readonly workflow: WorkflowStorage;
    readonly concept: ConceptStorage;
    readonly decision: DecisionStorage;
    readonly vocab: VocabStorage;

    constructor(private readonly ctx: IRunnerContext) {
        const prjdb = PrjDB.ensure(ctx.prj);
        this.workflow = new WorkflowStorage(prjdb);
        this.concept = new ConceptStorage(prjdb);
        this.decision = new DecisionStorage(prjdb);
        this.vocab = new VocabStorage(prjdb);
    }

    // ────────────────────────────────────────────────────────────────
    // 配置读取（从 config:weave_settings，与 prod2adimg 对齐）
    // ────────────────────────────────────────────────────────────────

    getConfig(): WeaveConfig {
        const defaults: WeaveConfig = {
            maxReactRounds: 4,
            maxPathsPerNode: 50,
            skipStandardParse: false,
        };
        const prjdb = PrjDB.ensure(this.ctx.prj);
        const stored = prjdb.get<Partial<WeaveConfig>>('config:weave_settings');
        return stored ? { ...defaults, ...stored } : defaults;
    }

    saveConfig(cfg: Partial<WeaveConfig>): void {
        const prjdb = PrjDB.ensure(this.ctx.prj);
        const current = this.getConfig();
        prjdb.set('config:weave_settings', { ...current, ...cfg });
    }

    // ────────────────────────────────────────────────────────────────
    // 入口输入（从 script，与 prod2adimg 对齐）
    // ────────────────────────────────────────────────────────────────

    getInputDocs(): string[] {
        return getInput(this.ctx, "script")
    }

    // ────────────────────────────────────────────────────────────────
    // 执行控制 target（从 "target"，与 prod2adimg 对齐）
    // ────────────────────────────────────────────────────────────────

    getTarget(): WeaveTarget | null {
        const prjdb = PrjDB.ensure(this.ctx.prj);
        return parseWeaveTarget(prjdb.get<string>('target'));
    }
}