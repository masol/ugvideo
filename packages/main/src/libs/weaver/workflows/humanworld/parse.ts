/**
 * weaver · 阶段 ① parse（unified 解析 + 标准格式检测）
 *
 * 职责：
 *   1. 用 unified 解析 markdown
 *   2. 检测是否为标准格式 → 是则直接产 StandardFlowDoc
 *   3. 否则输出粗提取的自然语言文本，供后续 LLM 阶段处理
 */

import { getSmartModel } from '$libs/model/balancer/get-smart-model.js';
import type { IRunnerContext } from '$types/blueprint/context.js';
import { generateText } from 'ai';
import type { Heading, List, ListItem, Paragraph, Root, RootContent } from 'mdast';
import remarkParse from 'remark-parse';
import { unified } from 'unified';
import type {
    StandardFlow,
    StandardFlowDoc,
    StandardGlobalInput,
    StandardJump,
    StandardStep,
} from '../../shared/types.js';
import type { WeaveContext } from '../../shared/weave-context.js';

const PARSE_INSTRUCTIONS = `你是工作流解析器。给定自然语言工作流文档，提取步骤骨架。

## 你的产物（markdown，禁止 JSON）

每个步骤输出：

**步骤 {order}：{name}**
- 目的：...
- 输入：...
- 输出：...
- 动作：...
- 跳转（如有）：
  - 若 ... → 步骤 N
  - 否则 → 步骤 M / 结束
  - 子流程：若 ... → 调用子流程 ... 的步骤 N（返回：是/否）

只输出 markdown 步骤列表。`;

export async function parsePipelines(
    ctx: WeaveContext,
    feedback?: string,
): Promise<{ flows: StandardFlowDoc; isStandard: boolean }> {
    const docs = ctx.userInputs;
    const flows: StandardFlow[] = [];

    let allStandard = true;

    for (let i = 0; i < docs.length; i++) {
        const doc = docs[i];
        const tree = unified().use(remarkParse).parse(doc);
        const standard = tryParseStandard(tree);

        if (standard) {
            flows.push(standard);
            continue;
        }

        allStandard = false;
        const llmResult = await llmCoarseParse(ctx.ctx, doc, feedback);
        const llmTree = unified().use(remarkParse).parse(llmResult);
        const llmStandard = tryParseStandard(llmTree);
        flows.push(llmStandard ?? llmResultAsPseudoStandard(llmResult, i));
    }

    const doc: StandardFlowDoc = { flows };
    ctx.storage.saveStandardDoc(doc);
    return { flows: doc, isStandard: allStandard };
}

// ════════════════════════════════════════════════════════════════════
// 标准格式检测与解析
// ════════════════════════════════════════════════════════════════════

const GLOBAL_INPUT_HEADING = /全局输入/;

function tryParseStandard(tree: Root): StandardFlow | null {
    const h1Nodes = tree.children.filter(
        (n): n is Heading => n.type === 'heading' && n.depth === 1,
    );
    if (h1Nodes.length !== 1) return null;

    const flowName = headingText(h1Nodes[0]);
    if (!flowName) return null;

    const sections = collectFlowSections(tree.children);

    // 1. 总则
    const goal = extractGoal(sections.preSteps);

    // 2. 全局输入段
    const globalInputSection = sections.sections.find(s =>
        s.heading && GLOBAL_INPUT_HEADING.test(s.heading),
    );
    if (!globalInputSection) return null;

    const globalInputs = parseGlobalInputs(globalInputSection.body);
    if (globalInputs === null) return null;

    // 3. 步骤段
    const stepSections = sections.sections.filter(s =>
        s.heading && /^(\d+)\.\s*.+/.test(s.heading),
    );
    if (stepSections.length === 0) return null;

    const steps: StandardStep[] = [];
    for (const sec of stepSections) {
        const step = parseStandardStep(sec);
        if (!step) return null;
        steps.push(step);
    }

    // 4. 步骤序号连续性
    for (let i = 0; i < steps.length; i++) {
        if (steps[i].order !== i + 1) return null;
    }

    return { name: flowName, goal, globalInputs, steps };
}

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

// ── 全局输入解析 ────────────────────────────────────────────────────

const RE_CONFIG = /^-\s*配置项\s+`([^`]+)`（默认：([^）]+)）\s*$/;
const RE_INPUT = /^-\s*输入项\s+`([^`]+)`\s*$/;

function parseGlobalInputs(body: RootContent[]): StandardGlobalInput[] | null {
    const inputs: StandardGlobalInput[] = [];
    for (const node of body) {
        if (node.type !== 'list') return null;
        const ordered = Boolean(node.ordered);
        if (ordered) return null;
        for (const item of node.children) {
            const text = plainText(item).trim();
            const mConfig = text.match(RE_CONFIG);
            const mInput = text.match(RE_INPUT);
            if (mConfig) {
                inputs.push({
                    key: mConfig[1],
                    hasDefault: true,
                    defaultValue: mConfig[2],
                });
            } else if (mInput) {
                inputs.push({ key: mInput[1], hasDefault: false });
            } else {
                return null;
            }
        }
    }
    return inputs;
}

// ── 步骤解析 ─────────────────────────────────────────────────────────

const REQUIRED_FIELDS = ['目的', '输入', '输出', '动作'] as const;

function parseStandardStep(section: FlowSection): StandardStep | null {
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
        const ordered = Boolean(node.ordered);
        if (ordered) return null;
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

    // 若 item 有子列表，追加子列表内容
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

// ── 跳转段解析 ──────────────────────────────────────────────────────

const RE_CONDITIONAL = /^\s*-\s*若\s+`([^`]+)`\s*→\s*步骤\s+(\d+)\s*$/;
const RE_FALLBACK_STEP = /^\s*-\s*否则\s*→\s*步骤\s+(\d+)\s*$/;
const RE_FALLBACK_END = /^\s*-\s*否则\s*→\s*结束\s*$/;
const RE_SUBPROCESS = /^\s*-\s*子流程：若\s+`([^`]+)`\s*→\s*调用子流程\s+`([^`]+)`\s*的步骤\s+(\d+)（返回：(是|否)）\s*$/;

function parseJumps(text: string): StandardJump[] | null {
    const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
    const jumps: StandardJump[] = [];
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
            });
        } else if (mFbStep) {
            jumps.push({
                kind: 'fallback',
                condition: null,
                targetStepOrder: parseInt(mFbStep[1], 10),
            });
            sawFallback = true;
        } else if (mFbEnd) {
            jumps.push({
                kind: 'fallback',
                condition: null,
                targetStepOrder: null,
            });
            sawFallback = true;
        } else if (mSub) {
            jumps.push({
                kind: 'subprocess',
                condition: mSub[1],
                targetSubFlowName: mSub[2],
                targetStepOrder: parseInt(mSub[3], 10),
                returnAfter: mSub[4] === '是',
            });
        } else {
            return null;
        }
    }

    return jumps;
}

// ── 工具 ─────────────────────────────────────────────────────────────

function headingText(node: Heading): string {
    return plainText(node);
}

/** 递归提取任意 mdast 节点的纯文本 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function plainText(node: RootContent | Paragraph['children'][number] | any): string {
    if ('value' in node && typeof node.value === 'string') return node.value;
    if ('children' in node && Array.isArray(node.children)) {
        return node.children.map(plainText).join('');
    }
    return '';
}

// ════════════════════════════════════════════════════════════════════
// LLM 兜底（非标准格式）
// ════════════════════════════════════════════════════════════════════

async function llmCoarseParse(
    ctx: IRunnerContext,
    doc: string,
    feedback?: string,
): Promise<string> {
    const model = getSmartModel(undefined, ctx);
    const prompt = feedback
        ? `## 上一轮反馈：\n${feedback}\n\n## 工作流文档：\n${doc}`
        : `## 工作流文档：\n${doc}`;

    const { text } = await generateText({
        model,
        instructions: PARSE_INSTRUCTIONS,
        prompt,
    });

    return text;
}

function llmResultAsPseudoStandard(_text: string, index: number): StandardFlow {
    return {
        name: `工作流 ${index + 1}`,
        goal: '',
        globalInputs: [],
        steps: [],
    };
}