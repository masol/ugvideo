/**
 * weaver · 阶段 ⑪ emit-standard-doc
 *
 * 将 HumanFlow 序列化为标准格式 markdown。
 * 再次输入可走纯代码路径，幂等。
 */

import type {
    ExternalEdge,
    HumanFlow,
    HumanNode,
} from '../../shared/types.js';
import type { WeaveContext } from '../../shared/weave-context.js';

export function emitStandardDoc(
    ctx: WeaveContext,
    flows: HumanFlow[],
): string {
    const sections: string[] = [];

    for (const flow of flows) {
        sections.push(renderFlow(flow, ctx));
    }

    const doc = sections.join('\n\n---\n\n');
    ctx.storage.saveStandardDoc({ flows: [] }); // 标记已生成
    return doc;
}

function renderFlow(flow: HumanFlow, ctx: WeaveContext): string {
    const lines: string[] = [];

    lines.push(`# ${flow.name}`);
    lines.push('');
    lines.push(flow.intent || '（无总则）');
    lines.push('');
    lines.push('---');
    lines.push('');

    // 全局输入
    const externals = ctx.compiled.getExternalInputs(flow.id);
    const configs = ctx.compiled.listAllExternalInputs()
        .filter(e => e.graphId === flow.id && e.providedBy === 'config');

    if (externals.length > 0 || configs.length > 0) {
        lines.push('## 全局输入');
        lines.push('');
        for (const cfg of configs) {
            lines.push(`- 配置项 \`${cfg.name}\`（默认：${cfg.defaultValue}）`);
        }
        for (const ext of externals) {
            lines.push(`- 输入项 \`${ext.name}\``);
        }
        lines.push('');
    }

    // 节点按添加顺序输出（已对齐为步骤序号）
    const nodes = flow.g.nodes().map(id => ctx.conceptTable.get(id))
        .filter((n): n is HumanNode => n !== null && (n.kind === 'flow-node' || n.kind === 'human'));

    for (let i = 0; i < nodes.length; i++) {
        const node = nodes[i];
        lines.push(`## ${i + 1}. ${node.name}`);
        lines.push('');
        lines.push(`- 目的：${node.intent}`);

        const inputNames = node.inputs.map(id => {
            const a = ctx.conceptTable.get(id);
            return a ? `\`${a.name}\`` : `\`${id.slice(0, 8)}\``;
        }).join(' ');
        lines.push(`- 输入：${inputNames}`);

        const outputNames = node.outputs.map(id => {
            const a = ctx.conceptTable.get(id);
            return a ? `\`${a.name}\`` : `\`${id.slice(0, 8)}\``;
        }).join(' ');
        lines.push(`- 输出：${outputNames}`);

        lines.push(`- 动作：${node.actionAtom}`);

        if (node.externalEdges.length > 0) {
            lines.push('- 跳转：');
            for (const edge of node.externalEdges) {
                lines.push(renderJumpLine(edge, nodes, ctx));
            }
        }
        lines.push('');
    }

    return lines.join('\n');
}

function renderJumpLine(
    edge: ExternalEdge,
    nodes: HumanNode[],
    ctx: WeaveContext,
): string {
    if (edge.kind === 'external') {
        const targetFlow = ctx.conceptTable.get(edge.targetGraphId);
        const subName = targetFlow ? targetFlow.name : edge.targetGraphId;
        return `  - 子流程：若 \`${edge.condition ?? ''}\` → 调用子流程 \`${subName}\` 的步骤 1（返回：${edge.returnAfter ? '是' : '否'}）`;
    }

    // internal
    const targetIdx = nodes.findIndex(n => n.id === edge.target);
    const targetRef = targetIdx >= 0 ? `步骤 ${targetIdx + 1}` : '结束';

    if (edge.condition) {
        return `  - 若 \`${edge.condition}\` → ${targetRef}`;
    }
    return `  - 否则 → ${targetRef}`;
}