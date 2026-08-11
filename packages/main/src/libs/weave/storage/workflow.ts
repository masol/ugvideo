/**
 * weaver · Workflow Storage
 */

import type { HumanFlow } from '../types.js';
import { BaseStorage } from './base.js';

export class WorkflowStorage extends BaseStorage {
    protected NS = '#weave:wf:';

    saveHumanFlow(flow: HumanFlow): void {
        const snapshot = { ...flow };
        this.write(`flow:${flow.id}`, snapshot);
        this.appendToIndex('idx:human_flows', flow.id);
    }

    getHumanFlow(id: string): HumanFlow | null {
        return this.read<HumanFlow>(`flow:${id}`);
    }

    listHumanFlowIds(): string[] {
        return this.read<string[]>('idx:human_flows') ?? [];
    }

    listHumanFlows(): HumanFlow[] {
        return this.listHumanFlowIds()
            .map(id => this.getHumanFlow(id))
            .filter((f): f is HumanFlow => f !== null);
    }

    saveFormalDoc(flowId: string, doc: string): void {
        this.write(`formal_doc:${flowId}`, doc);
    }

    getFormalDoc(flowId: string): string | null {
        return this.read<string>(`formal_doc:${flowId}`);
    }

    saveStandardDoc(doc: string): void {
        this.write('standard_doc', doc);
    }

    getStandardDoc(): string | null {
        return this.read<string>('standard_doc');
    }

    private appendToIndex(idxKey: string, id: string): void {
        const list = this.read<string[]>(idxKey) ?? [];
        if (!list.includes(id)) {
            this.write(idxKey, [...list, id]);
        }
    }
}