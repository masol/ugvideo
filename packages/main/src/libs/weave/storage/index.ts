/**
 * weaver · Storage 聚合入口
 */

import { getInput } from "$libs/blueprint/glossary/input.js";
import { PrjDB } from "$libs/project/controllers/drizzle/index.js";
import type { IRunnerContext } from "$types/blueprint/context.js";
import { ConceptStorage } from "./concept.js";
import { ConfigStorage } from "./config.js";
import { DecisionStorage } from "./decision.js";
import { VocabStorage } from "./vocab.js";
import { WorkflowStorage } from "./workflow.js";

export class WeaveStorage {
    readonly workflow: WorkflowStorage;
    readonly concept: ConceptStorage;
    readonly decision: DecisionStorage;
    readonly vocab: VocabStorage;
    readonly config: ConfigStorage;

    constructor(private readonly ctx: IRunnerContext) {
        const prjdb = PrjDB.ensure(ctx.prj);
        this.workflow = new WorkflowStorage(prjdb);
        this.concept = new ConceptStorage(prjdb);
        this.decision = new DecisionStorage(prjdb);
        this.vocab = new VocabStorage(prjdb);
        this.config = new ConfigStorage(prjdb);
    }

    getInputDocs(): string[] {
        return getInput(this.ctx, "script");
    }
}