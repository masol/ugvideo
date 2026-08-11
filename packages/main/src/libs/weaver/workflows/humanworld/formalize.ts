/**
 * weaver · 阶段 ⑥ formalize（纯代码优先）
 *
 * 基于已对齐的 IO + 步骤顺序，纯代码构造 DAG。
 * 仅在无法静态判定跳转条件时回退 LLM（本版本未启用 LLM 兜底，留接口）。
 */

import { randomUUID } from 'node:crypto';
import { addEdge, addNode, createGraph } from '../../shared/graph/gdag.js';
import type {
    Artifact,
    HumanFlow,
    HumanNode,
    StandardFlow,
    StandardStep
} from '../../shared/types.js';
import type { WeaveContext } from '../../shared/weave-context.js';

export function formalizeHumanFlow(
    ctx: WeaveContext,
    standards: StandardFlow[],
): { ok: boolean; flows: HumanFlow[] } {
    const flows: HumanFlow[] = [];

    for (const std of standards) {
        if (std.steps.length === 0) continue;
        const flow = buildFlowFromStandard(ctx, std);
        flows.push(flow);
    }

    return { ok: true, flows };
}

function buildFlowFromStandard(ctx: WeaveContext, std: StandardFlow): HumanFlow {
    const flowId = randomUUID();
    const g = createGraph();
    const stepIdByOrder = new Map<number, string>();
    const artifactIdByName = new Map<string, string>();

    // 1. 注册全局输入产生的 artifacts
    for (const gi of std.globalInputs) {
        const id = registerArtifact(ctx, gi.key, `global input: ${gi.key}`, gi.hasDefault);
        artifactIdByName.set(gi.key, id);
    }

    // 2. 创建节点
    for (const step of std.steps) {
        const nodeId = randomUUID();
        stepIdByOrder.set(step.order, nodeId);
        addNode(g, nodeId);

        // 注册 inputs artifacts（若未注册）
        for (const inputName of step.inputs) {
            if (!artifactIdByName.has(inputName)) {
                const id = registerArtifact(ctx, inputName, `input of ${step.name}`, false);
                artifactIdByName.set(inputName, id);
            }
        }

        // 注册 outputs artifacts
        for (const outputName of step.outputs) {
            if (!artifactIdByName.has(outputName)) {
                const id = registerArtifact(ctx, outputName, `output of ${step.name}`, false);
                artifactIdByName.set(outputName, id);
            }
        }
    }

    // 3. 添加顺序边 + 解析跳转
    const sequenceEdgeKeys = new Set<string>();

    for (let i = 0; i < std.steps.length; i++) {
        const step = std.steps[i];
        const fromId = stepIdByOrder.get(step.order)!;

        if (step.jumps.length === 0) {
            // 纯顺序流
            if (i < std.steps.length - 1) {
                const nextId = stepIdByOrder.get(step.order + 1)!;
                addEdge(g, fromId, nextId);
                sequenceEdgeKeys.add(edgeKey(fromId, nextId));
            }
            continue;
        }

        // 有跳转：不再添加默认顺序边，改由跳转段决定
        applyJumps(ctx, g, step, fromId, stepIdByOrder, sequenceEdgeKeys);
    }

    // 4. 注册 HumanNode
    for (const step of std.steps) {
        const nodeId = stepIdByOrder.get(step.order)!;
        const node = createHumanNode(step, nodeId, artifactIdByName);
        ctx.conceptTable.register(node);
    }

    // 5. 收集 ExternalInput（仅无默认值的视为 external input）
    const externalInputs = std.globalInputs
        .filter(gi => !gi.hasDefault)
        .map(gi => ({
            name: gi.key,
            alias: gi.key,
            providedBy: 'prompt-once' as const,
            hasDefault: false,
            consumedBy: collectConsumers(std.steps, gi.key),
            graphId: flowId,
        }));
    ctx.compiled.setExternalInputs(flowId, externalInputs);

    // 6. 配置项也注册（让 KB 可见）
    for (const gi of std.globalInputs) {
        if (gi.hasDefault) {
            ctx.compiled.addExternalInput(flowId, {
                name: gi.key,
                alias: gi.key,
                providedBy: 'config',
                hasDefault: true,
                defaultValue: gi.defaultValue,
                consumedBy: collectConsumers(std.steps, gi.key),
                graphId: flowId,
            });
        }
    }

    const flow: HumanFlow = {
        kind: 'dag',
        isHumanWorld: true,
        id: flowId,
        name: std.name,
        aliases: [],
        intent: std.goal,
        inferred: false,
        validatorIds: [],
        actionAtom: `执行 ${std.name}`,
        inputs: [],
        outputs: [],
        g,
        formalDoc: '',
    };

    return flow;
}

function applyJumps(
    ctx: WeaveContext,
    g: ReturnType<typeof createGraph>,
    step: StandardStep,
    fromId: string,
    stepIdByOrder: Map<number, string>,
    sequenceEdgeKeys: Set<string>,
): void {
    const node = ctx.conceptTable.get(fromId) as HumanNode | null;

    for (const jump of step.jumps) {
        if (jump.kind === 'subprocess') {
            // 子流程边：在 outer react 阶段解析 targetGraphId
            const targetStepId = stepIdByOrder.get(jump.targetStepOrder);
            if (targetStepId && node) {
                node.externalEdges.push({
                    kind: 'external',
                    condition: jump.condition,
                    targetGraphId: jump.targetSubFlowName, // 占位
                    targetNodeId: targetStepId,
                    returnAfter: jump.returnAfter,
                });
            }
            continue;
        }

        if (jump.kind === 'fallback' && jump.targetStepOrder === null) {
            // 否则 → 结束：不添加出边，让节点成为 terminal
            continue;
        }

        const targetOrder = jump.kind === 'fallback'
            ? jump.targetStepOrder!
            : jump.targetStepOrder;
        const targetId = stepIdByOrder.get(targetOrder);
        if (!targetId) continue;

        if (node) {
            node.externalEdges.push({
                kind: 'internal',
                condition: jump.kind === 'conditional' ? jump.condition : null,
                target: targetId,
            });
        }
        addEdge(g, fromId, targetId);
        sequenceEdgeKeys.add(edgeKey(fromId, targetId));
    }
}

function createHumanNode(
    step: StandardStep,
    nodeId: string,
    artifactIdByName: Map<string, string>,
): HumanNode {
    const inputIds = step.inputs
        .map(name => artifactIdByName.get(name))
        .filter((id): id is string => id !== undefined);
    const outputIds = step.outputs
        .map(name => artifactIdByName.get(name))
        .filter((id): id is string => id !== undefined);

    return {
        kind: 'human',
        id: nodeId,
        name: step.name,
        aliases: [],
        intent: step.intent,
        inferred: false,
        validatorIds: [],
        actionAtom: step.action,
        inputs: inputIds,
        outputs: outputIds,
        aligned: null,
        externalEdges: [],
    };
}

function registerArtifact(
    ctx: WeaveContext,
    name: string,
    intent: string,
    inferred: boolean,
): string {
    const existing = ctx.conceptTable.getByName(name);
    if (existing) return existing.id;

    const id = randomUUID();
    ctx.conceptTable.register({
        kind: 'artifact',
        id,
        name,
        aliases: [],
        intent,
        inferred,
        validatorIds: [],
        shape: 'scalar',
        semanticFields: [],
        dataSchema: null,
    } as Artifact);
    return id;
}

function collectConsumers(steps: StandardStep[], artifactName: string): string[] {
    return steps
        .filter(s => s.inputs.includes(artifactName))
        .map(s => s.name);
}

function edgeKey(from: string, to: string): string {
    return `${from}->${to}`;
}