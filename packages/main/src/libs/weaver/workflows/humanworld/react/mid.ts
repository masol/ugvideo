/**
 * weaver · 中层 reAct
 */

import type { HumanFlow } from '../../../shared/types.js';
import type { WeaveContext } from '../../../shared/weave-context.js';
import { alignVocabulary } from '../align-vocabulary.js';
import { collectMacro } from '../collect-macro.js';
import { emitFormalDoc } from '../emit-formal-doc.js';
import { emitStandardDoc } from '../emit-standard-doc.js';
import { formalizeHumanFlow } from '../formalize.js';
import { identifyStepOutputs } from '../identify-step-output.js';
import { parsePipelines } from '../parse.js';
import { splitCompoundActions } from '../split-actions.js';
import { validateHumanFlows } from '../validate.js';

const MAX_ROUNDS = 4;

export async function runMidLayer(
    ctx: WeaveContext,
    initialFeedback?: string,
): Promise<HumanFlow[]> {
    let feedback: string | undefined = initialFeedback;

    for (let round = 1; round <= MAX_ROUNDS; round++) {
        ctx.notify('中层 reAct', `第 ${round} 轮开始${feedback ? '（含反馈）' : ''}`);

        // ① parse（含标准格式检测）
        const { flows: standards, isStandard } = await parsePipelines(ctx, feedback);
        if (standards.flows.length === 0) {
            feedback = 'parse 阶段无产出';
            continue;
        }

        // 标准格式短路：已含完整 IO，可直接形式化
        const allStepsHaveIO = standards.flows.every(
            f => f.steps.every(s => s.inputs.length > 0 || s.outputs.length > 0),
        );

        if (isStandard && allStepsHaveIO) {
            const { ok, flows } = formalizeHumanFlow(ctx, standards.flows);
            if (ok) {
                const valid = await validateHumanFlows(ctx, flows);
                if (valid.ok) {
                    await emitFormalDoc(ctx, flows);
                    emitStandardDoc(ctx, flows);
                    return flows;
                }
                feedback = valid.feedback;
                continue;
            }
        }

        // LLM 路径
        for (const std of standards.flows) {
            const docText = ctx.userInputs[standards.flows.indexOf(std)];
            await collectMacro(ctx, docText);
        }

        const ioText = standards.flows
            .map(f => f.steps.map(s =>
                `步骤 ${s.order} ${s.name}: inputs=${s.inputs.join(',')} outputs=${s.outputs.join(',')}`,
            ).join('\n'))
            .join('\n\n');

        const upstreamArtifacts: string[] = [];
        for (const f of standards.flows) {
            for (const gi of f.globalInputs) upstreamArtifacts.push(gi.key);
        }

        await identifyStepOutputs(ctx, ioText, upstreamArtifacts);
        await splitCompoundActions(ctx, [], isStandard);
        await alignVocabulary(ctx, ioText);

        const { ok, flows } = formalizeHumanFlow(ctx, standards.flows);
        if (!ok) {
            feedback = 'formalize 失败';
            continue;
        }

        const valid = await validateHumanFlows(ctx, flows);
        if (valid.ok) {
            await emitFormalDoc(ctx, flows);
            emitStandardDoc(ctx, flows);
            return flows;
        }

        feedback = valid.feedback;
        ctx.warn(`[mid-react] 第 ${round} 轮校验失败：\n${feedback?.substring(0, 200)}`);
    }

    throw new Error(`[mid-react] ${MAX_ROUNDS} 轮未收敛`);
}