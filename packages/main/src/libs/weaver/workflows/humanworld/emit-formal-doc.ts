/**
 * weaver · 阶段 ⑩ emit-formal-doc
 */

import { topoOrder } from '../../shared/graph/graph-ops.js';
import type { HumanFlow, HumanNode } from '../../shared/types.js';
import type { WeaveContext } from '../../shared/weave-context.js';

export async function emitFormalDoc(
    ctx: WeaveContext,
    flows: HumanFlow[],
): Promise<string> {
    const sections: string[] = [];

    sections.push('# 人类工作流形式化文档\n');
    sections.push(`## 全局目标\n${ctx.globalGoal}\n`);

    for (const flow of flows) {
        sections.push(`\n## 工作流：${flow.name}\n`);
        sections.push(`- ID：\`${flow.id}\``);
        sections.push(`- 意图：${flow.intent}`);
        sections.push(`- 节点数：${flow.g.order}`);
        sections.push(`- 边数：${flow.g.size}`);

        const extInputs = ctx.compiled.getExternalInputs(flow.id);
        if (extInputs.length > 0) {
            sections.push(`\n### 外部输入\n`);
            for (const ext of extInputs) {
                sections.push(`- ${ext.name}（${ext.providedBy}${ext.hasDefault ? ` 默认=${ext.defaultValue}` : ''}）`);
            }
        }

        sections.push(`\n### 节点清单（拓扑序）\n`);
        const order = topoOrder(flow.g);
        for (const nodeId of order) {
            const node = ctx.conceptTable.get(nodeId);
            if (!node || (node.kind !== 'flow-node' && node.kind !== 'human')) continue;
            const humanNode = node as HumanNode;

            const inputNames = humanNode.inputs.map(id => {
                const a = ctx.conceptTable.get(id);
                return a && a.kind === 'artifact' ? a.name : id.slice(0, 8);
            });
            const outputNames = humanNode.outputs.map(id => {
                const a = ctx.conceptTable.get(id);
                return a && a.kind === 'artifact' ? a.name : id.slice(0, 8);
            });

            sections.push(`\n**${humanNode.name}** (\`${humanNode.id.slice(0, 8)}\`)`);
            sections.push(`- 意图：${humanNode.intent}`);
            sections.push(`- 动作原子：${humanNode.actionAtom}`);
            sections.push(`- 输入：${inputNames.join(', ')}`);
            sections.push(`- 输出：${outputNames.join(', ')}`);
            if (humanNode.aligned) {
                sections.push(`- 执行器：${humanNode.aligned.kind}${humanNode.aligned.toolId ? `（工具：${humanNode.aligned.toolId}）` : ''}`);
            }
            if (humanNode.validatorIds.length > 0) {
                sections.push(`- 约束：${humanNode.validatorIds.length} 条`);
            }
        }

        const inferences = ctx.compiled.getInferences().filter(i => i.target === flow.id);
        if (inferences.length > 0) {
            sections.push(`\n### 编译器补全项\n`);
            for (const inf of inferences) {
                sections.push(`- [${inf.kind}] ${inf.note}`);
            }
        }
    }

    const doc = sections.join('\n');
    ctx.notify('形式化文档生成完成', `共 ${flows.length} 个工作流，总计 ${ctx.conceptTable.count()} 个概念`);

    return doc;
}