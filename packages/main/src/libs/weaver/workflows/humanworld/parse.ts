/**
 * weaver · 阶段 ① parse-pipelines
 */

import { getSmartModel } from '$libs/model/balancer/get-smart-model.js';
import { generateText } from 'ai';
import { randomUUID } from 'node:crypto';
import { addEdge, addNode, createGraph } from '../../shared/graph/gdag.js';
import type { Artifact, HumanFlow, HumanNode } from '../../shared/types.js';
import type { WeaveContext } from '../../shared/weave-context.js';

const PARSE_INSTRUCTIONS = `你是工作流解析器。给定用户用自然语言描述的工作流文档，提取其中的步骤、顺序、条件分支、子流程引用。

## 你的产物（必须是 markdown 分节，禁止 JSON）

### 步骤清单

按顺序列出所有步骤，每步一行：

**步骤 N：{动作名}**
- 输入材料：{看哪些已有材料}
- 做什么：{具体动作}
- 产出：{新增的中间交付物}

【关键规则】
- 每步恰好产出 1 个中间交付物（不能一步产出多份）
- 步骤名必须是动宾结构且宾语具体
- 步骤之间通过交付物串联

### 条件分支

列出所有"如果 X 则转 Y"形式的条件分支：

**条件：{条件描述}**
- 真分支：转步骤 N
- 假分支：转步骤 M（或"结束"）

### 子流程引用

列出所有"调用子流程 X"或"转 X 子流程"形式的引用：

**子流程：{子流程名称}**
- 调用点：步骤 N
- 返回后是否继续：是 / 否

【反合并铁律】
- 禁止把多个原子操作打包成一步
- 步骤必须可独立验证

只输出上述 markdown，不要输出 JSON 或其他格式。`;

export async function parsePipelines(
    ctx: WeaveContext,
    feedback?: string,
): Promise<HumanFlow[]> {
    const model = getSmartModel(undefined, ctx.ctx);

    const docs = ctx.userInputs;
    const flows: HumanFlow[] = [];

    for (let i = 0; i < docs.length; i++) {
        const doc = docs[i];
        const userPrompt = feedback
            ? `## 上一轮解析失败，请修正：\n${feedback}\n\n## 工作流文档：\n${doc}`
            : `## 工作流文档：\n${doc}`;

        const { text } = await generateText({
            model,
            instructions: PARSE_INSTRUCTIONS,
            prompt: userPrompt,
        });

        const flow = parseMarkdownToFlow(text, docs[i], i, ctx);
        flows.push(flow);
    }

    return flows;
}

function parseMarkdownToFlow(
    markdown: string,
    sourceDoc: string,
    index: number,
    ctx: WeaveContext,
): HumanFlow {
    const flowId = randomUUID();
    const g = createGraph();
    const externalInputNames: string[] = [];

    const stepRegex = /\*\*步骤\s+(\d+)[：:]\s*([^*]+)\*\*\s*\n\s*- 输入材料[：:]\s*([^\n]+)\s*\n\s*- 做什么[：:]\s*([^\n]+)\s*\n\s*- 产出[：:]\s*([^\n]+)/g;
    const steps: Array<{ order: number; name: string; input: string; action: string; output: string }> = [];
    let m: RegExpExecArray | null;
    while ((m = stepRegex.exec(markdown)) !== null) {
        steps.push({
            order: parseInt(m[1], 10),
            name: m[2].trim(),
            input: m[3].trim(),
            action: m[4].trim(),
            output: m[5].trim(),
        });
    }

    const condRegex = /\*\*条件[：:]\s*([^*]+)\*\*\s*\n\s*- 真分支[：:]\s*转步骤\s+(\d+)\s*\n\s*- 假分支[：:]\s*(?:转步骤\s+(\d+)|(结束))/g;
    const conditions: Array<{ condition: string; trueTarget: number; falseTarget: number | null }> = [];
    while ((m = condRegex.exec(markdown)) !== null) {
        conditions.push({
            condition: m[1].trim(),
            trueTarget: parseInt(m[2], 10),
            falseTarget: m[3] ? parseInt(m[3], 10) : null,
        });
    }

    const subProcessRegex = /\*\*子流程[：:]\s*([^*]+)\*\*\s*\n\s*- 调用点[：:]\s*步骤\s+(\d+)\s*\n\s*- 返回后是否继续[：:]\s*(是|否)/g;
    const subProcesses: Array<{ name: string; fromStep: number; returnAfter: boolean }> = [];
    while ((m = subProcessRegex.exec(markdown)) !== null) {
        subProcesses.push({
            name: m[1].trim(),
            fromStep: parseInt(m[2], 10),
            returnAfter: m[3].trim() === '是',
        });
    }

    const nodeMap = new Map<number, string>();
    const artifactMap = new Map<string, string>();

    for (const step of steps) {
        const nodeId = randomUUID();
        nodeMap.set(step.order, nodeId);
        addNode(g, nodeId);

        const inputNames = step.input.split(/[、,，]/).map(s => s.trim()).filter(Boolean);
        for (const inputName of inputNames) {
            if (!artifactMap.has(inputName)) {
                const artifactId = randomUUID();
                artifactMap.set(inputName, artifactId);
                const artifact: Artifact = {
                    kind: 'artifact',
                    id: artifactId,
                    name: inputName,
                    aliases: [],
                    intent: `parsed from "${step.name}"`,
                    inferred: false,
                    validatorIds: [],
                    shape: 'scalar',
                    semanticFields: [],
                    dataSchema: null,
                }
                ctx.conceptTable.register(artifact);
            }
        }

        if (!artifactMap.has(step.output)) {
            const artifactId = randomUUID();
            artifactMap.set(step.output, artifactId);
            const artifact: Artifact = {
                kind: 'artifact',
                id: artifactId,
                name: step.output,
                aliases: [],
                intent: `produced by "${step.name}"`,
                inferred: false,
                validatorIds: [],
                shape: 'scalar',
                semanticFields: [],
                dataSchema: null,
            }
            ctx.conceptTable.register(artifact);
        }

        const inputIds = inputNames.map(n => artifactMap.get(n)!);
        const outputId = artifactMap.get(step.output)!;

        const node: HumanNode = {
            kind: 'human',
            id: nodeId,
            name: step.name,
            aliases: [],
            intent: step.action,
            inferred: false,
            validatorIds: [],
            actionAtom: step.action,
            inputs: inputIds,
            outputs: [outputId],
            aligned: null,
            externalEdges: [],
        };
        ctx.conceptTable.register(node);
    }

    for (let i = 0; i < steps.length - 1; i++) {
        const from = nodeMap.get(steps[i].order);
        const to = nodeMap.get(steps[i + 1].order);
        if (from && to) {
            addEdge(g, from, to, {});
        }
    }

    for (const cond of conditions) {
        const fromId = nodeMap.get(cond.trueTarget - 1);
        const toId = nodeMap.get(cond.trueTarget);
        if (fromId && toId) {
            addEdge(g, fromId, toId, {});
        }
        if (cond.falseTarget !== null) {
            const fromId2 = nodeMap.get(cond.falseTarget - 1);
            const toId2 = nodeMap.get(cond.falseTarget);
            if (fromId2 && toId2) {
                addEdge(g, fromId2, toId2, {});
            }
        }
    }

    const flow: HumanFlow = {
        kind: 'dag',
        isHumanWorld: true,
        id: flowId,
        name: `工作流 ${index + 1}`,
        aliases: [],
        intent: sourceDoc,
        inferred: false,
        validatorIds: [],
        actionAtom: `执行工作流 ${index + 1}`,
        inputs: [],
        outputs: [],
        g,
        formalDoc: '',
    };

    ctx.compiled.setExternalInputs(flowId, externalInputNames.map(name => ({
        name,
        alias: name,
        providedBy: 'prompt-once' as const,
        consumedBy: [],
        graphId: flowId,
    })));

    return flow;
}