import { getSmartModel } from '$libs/model/index.js';
import { throwUnprcessable } from '$libs/utils/err.js';
import { dataCenter } from '$libs/utils/sys/data.js';
import { ToolLoopAgent, isStepCount, tool } from 'ai';
import Handlebars, { type TemplateDelegate } from 'handlebars';
import { clarifyInputSchema, clarifyOutputSchema, userClarifyTool } from './clarify/index.js';
import { CommonContext } from './context.js';
import { doTask, execIniputSchema, execOutputSchema, type ExecOutput } from './task/index.js';

export class TargetLoop {
    private compiled: TemplateDelegate | null = null;

    private async init() {
        if (this.compiled) {
            return;
        }
        const sysTpl = await dataCenter.readFile("prompt", "target.md");
        if (sysTpl) {
            this.compiled = Handlebars.compile(sysTpl);
        }
    }

    private async loadHistory(cctx: CommonContext): Promise<string> {
        await this.init();
        if (!this.compiled) {
            throwUnprcessable("无法初始化目标循环，未能加载target.md提示词模板。")
        }
        // @todo: loadHistroy.
        return this.compiled({
            maxSteps: cctx.storage.config.getMaxTargetSteps()
        });
    }

    async run(cctx: CommonContext): Promise<void> {

        const system = await this.loadHistory(cctx);

        cctx.ctx.debug("cctx.storage.config.getMaxTargetSteps()=", cctx.storage.config.getMaxTargetSteps());

        const targetAgent = new ToolLoopAgent({
            model: getSmartModel(undefined, cctx.ctx),
            instructions: system,
            stopWhen: isStepCount(cctx.storage.config.getMaxTargetSteps()),
            tools: {
                clarify: tool({
                    description: '当用户请求信息不足（目标模糊/缺少关键参数/存在多种解读）时，向用户提出具体追问以收集必要信息。参数 question 必须是一句明确的、可回答的追问。',
                    inputSchema: clarifyInputSchema,
                    outputSchema: clarifyOutputSchema,
                    execute: async (input) => {
                        return await userClarifyTool.callTool(input, cctx);
                    },
                }),
                exec: tool({
                    description: '将复杂任务委托给子Agent执行。用于需要调研/分析/创作/多步骤流程/专业知识的任务，或对历史任务的修改补充。',
                    inputSchema: execIniputSchema,
                    outputSchema: execOutputSchema,
                    execute: async ({ goal, target_user, use_scenario, alternatives = "", requirements = [], context = '' }): Promise<ExecOutput> => {
                        const result = await doTask({ goal, target_user, use_scenario, alternatives, requirements, context }, cctx);
                        return result;
                    },
                }),
            }
        });


        const result = await targetAgent.generate({
            prompt: cctx.ctx.cmd.body
        });

        cctx.ctx.debug("result=", result)

        cctx.ctx.notify("", result.text ?? "")
    }
}


const KEY = Symbol.for('unigen.singleton.TargetLoop');
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const targetLoop: TargetLoop = ((globalThis as any)[KEY] ??= new TargetLoop());