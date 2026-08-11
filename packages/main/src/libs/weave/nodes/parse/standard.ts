/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * weaver · parse · 标准格式校验 + 构造 HumanFlow
 *
 * 输入：MDAST（由 parse/index.ts 产出）
 * 输出：{ flow, errors }
 */

import type { Heading, List, ListItem, Root, RootContent } from 'mdast';
import { randomUUID } from 'node:crypto';
import type { WeaveContext } from '../../context.js';
import { addEdge, addNode, createGraph } from '../../graph/gdag.js';
import { errorsToString, validateHumanFlow } from '../../graph/validate.js';
import type {
    Artifact,
    ExternalInput,
    HumanFlow,
    HumanNode,
} from '../../types.js';

export interface StandardResult {
    flow: HumanFlow | null;
    errors: string[];
}

export function tryStandard(tree: Root, ctx: WeaveContext): StandardResult {
    const errors: string[] = [];

    const h1Nodes = tree.children.filter(
        (n): n is Heading => n.type === 'heading' && n.depth === 1,
    );
    if (h1Nodes.length !== 1) {
        errors.push('必须恰好 1 个一级标题');
        return { flow: null, errors };
    }

    const flowName = headingText(h1Nodes[0]);
    if (!flowName) {
        errors.push('一级标题为空');
        return { flow: null, errors };
    }

    const sections = collectFlowSections(tree.children);
    const goal = extractGoal(sections.preSteps);

    const globalInputSection = sections.sections.find(s =>
        s.heading && /^全局输入$/.test(s.heading),
    );
    if (!globalInputSection) {
        errors.push('缺少「全局输入」段');
        return { flow: null, errors };
    }

    const globalInputs = parseGlobalInputs(globalInputSection.body);
    if (globalInputs === null) {
        errors.push('全局输入段格式非法');
        return { flow: null, errors };
    }

    const stepSections = sections.sections.filter(s =>
        s.heading && /^(\d+)\.\s*.+/.test(s.heading),
    );
    if (stepSections.length === 0) {
        errors.push('至少需要 1 个步骤');
        return { flow: null, errors };
    }

    const steps: ParsedStep[] = [];
    for (const sec of stepSections) {
        const step = parseStandardStep(sec);
        if (!step) {
            errors.push(`步骤「${sec.heading}」格式非法`);
            return { flow: null, errors };
        }
        steps.push(step);
    }

    for (let i = 0; i < steps.length; i++) {
        if (steps[i].order !== i + 1) {
            errors.push(`步骤序号不连续：期望 ${i + 1}，实际 ${steps[i].order}`);
            return { flow: null, errors };
        }
    }

    const flow = buildHumanFlow(flowName, goal, globalInputs, steps, ctx);

    // DAG 校验
    const validationErrors = validateHumanFlow(flow, ctx.conceptTable, ctx.compiled);
    if (validationErrors.length > 0) {
        return { flow: null, errors: [errorsToString(validationErrors)] };
    }

    return { flow, errors: [] };
}

interface ParsedGlobalInput {
    key: string;
    hasDefault: boolean;
    defaultValue?: string;
}

interface ParsedJump {
    kind: 'conditional' | 'fallback' | 'subprocess';
    condition: string | null;
    targetStepOrder: number | null;
    targetSubFlowName?: string;
    returnAfter?: boolean;
}

interface ParsedStep {
    order: number;
    name: string;
    intent: string;
    inputs: string[];
    outputs: string[];
    action: string;
    jumps: ParsedJump[];
}

function buildHumanFlow(
    flowName: string,
    goal: string,
    globalInputs: ParsedGlobalInput[],
    steps: ParsedStep[],
    ctx: WeaveContext,
): HumanFlow {
    const flowId = randomUUID();
    const g = createGraph();
    const stepIdByOrder = new Map<number, string>();
    const artifactIdByName = new Map<string, string>();

    // 注册全局输入 artifacts
    for (const gi of globalInputs) {
        const id = registerArtifact(ctx, gi.key, `全局输入：${gi.key}`, true);
        artifactIdByName.set(gi.key, id);
    }

    // 注册步骤 + artifacts
    for (const step of steps) {
        const nodeId = randomUUID();
        stepIdByOrder.set(step.order, nodeId);
        addNode(g, nodeId);

        for (const inputName of step.inputs) {
            if (!artifactIdByName.has(inputName)) {
                const id = registerArtifact(ctx, inputName, `${step.name} 的输入`, false);
                artifactIdByName.set(inputName, id);
            }
        }

        for (const outputName of step.outputs) {
            if (!artifactIdByName.has(outputName)) {
                const id = registerArtifact(ctx, outputName, `${step.name} 的输出`, false);
                artifactIdByName.set(outputName, id);
            }
        }
    }

    // 添加边
    for (let i = 0; i < steps.length; i++) {
        const step = steps[i];
        const fromId = stepIdByOrder.get(step.order)!;

        if (step.jumps.length === 0) {
            if (i < steps.length - 1) {
                const nextId = stepIdByOrder.get(step.order + 1)!;
                addEdge(g, fromId, nextId);
            }
        } else {
            applyJumps(g, step, fromId, stepIdByOrder);
        }
    }

    // 注册 HumanNode
    for (const step of steps) {
        const nodeId = stepIdByOrder.get(step.order)!;
        const node = createHumanNode(step, nodeId, artifactIdByName);
        ctx.conceptTable.register(node);
    }

    // 构造 ExternalInput（指向 artifact + 默认值）
    const externalInputs: ExternalInput[] = [];
    for (const gi of globalInputs) {
        const artifactId = artifactIdByName.get(gi.key);
        if (artifactId) {
            externalInputs.push({
                artifactId,
                defaultValue: gi.defaultValue,
            });
        }
    }
    ctx.compiled.setExternalInputs(flowId, externalInputs);

    // 图级 inputs/outputs
    const flowInputIds = globalInputs
        .filter(gi => !gi.hasDefault)
        .map(gi => artifactIdByName.get(gi.key)!)
        .filter(Boolean);

    const terminalNodes = steps
        .filter(s => stepIdByOrder.has(s.order))
        .map(s => ctx.conceptTable.get(stepIdByOrder.get(s.order)!))
        .filter((n): n is HumanNode => n !== null && (n.kind === 'human' || n.kind === 'flow-node'))
        .filter(n => g.outDegree(n.id) === 0);
    const flowOutputIds = terminalNodes.flatMap(n => n.outputs);

    const flow: HumanFlow = {
        kind: 'dag',
        isHumanWorld: true,
        id: flowId,
        name: flowName,
        aliases: [],
        intent: goal,
        inferred: false,
        validatorIds: [],
        actionAtom: `执行 ${flowName}`,
        inputs: flowInputIds,
        outputs: flowOutputIds,
        g,
        formalDoc: '',
    };

    return flow;
}

function applyJumps(
    g: ReturnType<typeof createGraph>,
    step: ParsedStep,
    fromId: string,
    stepIdByOrder: Map<number, string>,
): void {
    for (const jump of step.jumps) {
        if (jump.kind === 'subprocess') continue;
        if (jump.kind === 'fallback' && jump.targetStepOrder === null) continue;

        const targetOrder = jump.targetStepOrder!;
        const targetId = stepIdByOrder.get(targetOrder);
        if (!targetId) continue;

        addEdge(g, fromId, targetId);
    }
}

function createHumanNode(
    step: ParsedStep,
    nodeId: string,
    artifactIdByName: Map<string, string>,
): HumanNode {
    const inputIds = step.inputs
        .map(name => artifactIdByName.get(name))
        .filter((id): id is string => id !== undefined);
    const outputIds = step.outputs
        .map(name => artifactIdByName.get(name))
        .filter((id): id is string => id !== undefined);

    const externalEdges = step.jumps
        .filter(j => j.kind === 'conditional' || j.kind === 'fallback')
        .map(j => ({
            kind: 'internal' as const,
            condition: j.condition,
            target: '',
        }));

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
        externalEdges,
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

// ════════════════════════════════════════════════════════════════════
// markdown 结构提取
// ════════════════════════════════════════════════════════════════════

interface FlowSection {
    heading: string | null;
    body: RootContent[];
}

interface FlowSections {
    preSteps: RootContent[];
    sections: FlowSection[];
}

function collectFlowSections(children: RootContent[]): FlowSections {
    const preSteps: RootContent[] = [];
    const sections: FlowSection[] = [];
    let current: FlowSection | null = null;
    let passedH1 = false;

    for (const node of children) {
        if (node.type === 'heading' && node.depth === 1) {
            passedH1 = true;
            continue;
        }
        if (!passedH1) continue;

        if (node.type === 'heading' && node.depth === 2) {
            current = { heading: headingText(node), body: [] };
            sections.push(current);
            continue;
        }

        if (current) {
            current.body.push(node);
        } else {
            preSteps.push(node);
        }
    }

    return { preSteps, sections };
}

function extractGoal(preSteps: RootContent[]): string {
    const texts: string[] = [];
    for (const node of preSteps) {
        if (node.type === 'paragraph') {
            texts.push(plainText(node));
        } else if (node.type === 'thematicBreak') {
            break;
        }
    }
    return texts.join('\n\n').trim();
}

const RE_CONFIG = /^-\s*配置项\s+`([^`]+)`（默认：([^）]+)）\s*$/;
const RE_INPUT = /^-\s*输入项\s+`([^`]+)`\s*$/;

function parseGlobalInputs(body: RootContent[]): ParsedGlobalInput[] | null {
    const inputs: ParsedGlobalInput[] = [];
    for (const node of body) {
        if (node.type !== 'list') return null;
        if (node.ordered) return null;
        for (const item of node.children) {
            const text = plainText(item).trim();
            const mConfig = text.match(RE_CONFIG);
            const mInput = text.match(RE_INPUT);
            if (mConfig) {
                inputs.push({ key: mConfig[1], hasDefault: true, defaultValue: mConfig[2] });
            } else if (mInput) {
                inputs.push({ key: mInput[1], hasDefault: false });
            } else {
                return null;
            }
        }
    }
    return inputs;
}

const REQUIRED_FIELDS = ['目的', '输入', '输出', '动作'] as const;

function parseStandardStep(section: FlowSection): ParsedStep | null {
    const m = section.heading!.match(/^(\d+)\.\s*(.+)$/);
    if (!m) return null;

    const order = parseInt(m[1], 10);
    const name = m[2].trim();

    const fields = extractListFields(section.body);
    if (!fields) return null;

    for (const required of REQUIRED_FIELDS) {
        if (!(required in fields)) return null;
    }

    const inputs = parseArtifactList(fields['输入']);
    const outputs = parseArtifactList(fields['输出']);
    if (inputs === null || outputs === null) return null;

    const jumps = fields['跳转'] ? parseJumps(fields['跳转']) : [];
    if (fields['跳转'] && jumps === null) return null;

    return {
        order,
        name,
        intent: fields['目的'].trim(),
        inputs,
        outputs,
        action: fields['动作'].trim(),
        jumps: jumps ?? [],
    };
}

function extractListFields(body: RootContent[]): Record<string, string> | null {
    const fields: Record<string, string> = {};
    for (const node of body) {
        if (node.type !== 'list') return null;
        if (node.ordered) return null;
        for (const item of node.children) {
            const parsed = parseFieldItem(item);
            if (!parsed) return null;
            fields[parsed.key] = parsed.value;
        }
    }
    return fields;
}

function parseFieldItem(item: ListItem): { key: string; value: string } | null {
    const firstChild = item.children[0];
    if (!firstChild || firstChild.type !== 'paragraph') return null;

    const text = plainText(firstChild).trim();
    const m = text.match(/^([^\s：:]+)[：:]\s*([\s\S]*)$/);
    if (!m) return null;

    const key = m[1];
    const inlineValue = m[2];

    if (item.children.length > 1) {
        const subLists = item.children.slice(1).filter(
            (c): c is List => c.type === 'list',
        );
        if (subLists.length > 0) {
            const subTexts: string[] = [inlineValue];
            for (const sub of subLists) {
                for (const subItem of sub.children) {
                    subTexts.push('- ' + plainText(subItem).trim());
                }
            }
            return { key, value: subTexts.join('\n') };
        }
    }

    return { key, value: inlineValue };
}

function parseArtifactList(text: string): string[] | null {
    const names: string[] = [];
    const re = /`([^`]+)`/g;
    let m: RegExpExecArray | null;
    let lastIndex = 0;
    while ((m = re.exec(text)) !== null) {
        if (m.index !== lastIndex) {
            const between = text.slice(lastIndex, m.index).trim();
            if (between) return null;
        }
        names.push(m[1]);
        lastIndex = re.lastIndex;
    }
    if (lastIndex !== text.length) {
        const tail = text.slice(lastIndex).trim();
        if (tail) return null;
    }
    return names;
}

const RE_CONDITIONAL = /^\s*-\s*若\s+`([^`]+)`\s*→\s*步骤\s+(\d+)\s*$/;
const RE_FALLBACK_STEP = /^\s*-\s*否则\s*→\s*步骤\s+(\d+)\s*$/;
const RE_FALLBACK_END = /^\s*-\s*否则\s*→\s*结束\s*$/;
const RE_SUBPROCESS = /^\s*-\s*子流程：若\s+`([^`]+)`\s*→\s*调用子流程\s+`([^`]+)`\s*的步骤\s+(\d+)（返回：(是|否)）\s*$/;

function parseJumps(text: string): ParsedJump[] | null {
    const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
    const jumps: ParsedJump[] = [];
    let sawFallback = false;

    for (const line of lines) {
        const mCond = line.match(RE_CONDITIONAL);
        const mFbStep = line.match(RE_FALLBACK_STEP);
        const mFbEnd = line.match(RE_FALLBACK_END);
        const mSub = line.match(RE_SUBPROCESS);

        if (mCond) {
            if (sawFallback) return null;
            jumps.push({
                kind: 'conditional',
                condition: mCond[1],
                targetStepOrder: parseInt(mCond[2], 10),
                targetSubFlowName: undefined,
                returnAfter: undefined,
            });
        } else if (mFbStep) {
            jumps.push({
                kind: 'fallback',
                condition: null,
                targetStepOrder: parseInt(mFbStep[1], 10),
                targetSubFlowName: undefined,
                returnAfter: undefined,
            });
            sawFallback = true;
        } else if (mFbEnd) {
            jumps.push({
                kind: 'fallback',
                condition: null,
                targetStepOrder: null,
                targetSubFlowName: undefined,
                returnAfter: undefined,
            });
            sawFallback = true;
        } else if (mSub) {
            jumps.push({
                kind: 'subprocess',
                condition: mSub[1],
                targetStepOrder: parseInt(mSub[3], 10),
                targetSubFlowName: mSub[2],
                returnAfter: mSub[4] === '是',
            });
        } else {
            return null;
        }
    }

    return jumps;
}

function headingText(node: Heading): string {
    return plainText(node);
}

function plainText(node: any): string {
    if ('value' in node && typeof node.value === 'string') return node.value;
    if ('children' in node && Array.isArray(node.children)) {
        return node.children.map(plainText).join('');
    }
    return '';
}