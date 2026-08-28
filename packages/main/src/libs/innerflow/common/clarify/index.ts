import Logger from "electron-log/main.js";
import { randomUUID } from "node:crypto";
import pTimeout from "p-timeout";
import z from "zod";
import type { CommonContext } from "../context.js";

// ---------- Schema 定义 ----------
export const clarifyInputSchema = z.object({
    question: z.string().describe('具体的追问内容，例如："请问报告的主题和用途是什么？"'),
    options: z.array(z.string()).optional().describe('可选的快速答案列表，供用户一键选择'),
});

export const clarifyOutputSchema = z.object({
    user_response: z.string().describe('用户对追问的回答'),
});

export type ClarifyOutput = z.infer<typeof clarifyOutputSchema>;
export type ClarifyInput = z.infer<typeof clarifyInputSchema>;

// ---------- 用户追问工具类（单例） ----------
type PendingEntry = {
    resolve: (value: ClarifyOutput) => void;
    reject: (reason?: string) => void;
};

/**
 * 用户追问工具类，提供 callTool 方法处理澄清交互（异步等待模式）
 */
class UserClarifyTool {
    private pendingClarifications = new Map<string, PendingEntry>();

    async callTool(input: ClarifyInput, cctx: CommonContext): Promise<ClarifyOutput> {
        const uuid = randomUUID();
        const defaultResponse: ClarifyOutput = { user_response: "你自己随意确定吧。" };

        cctx.ctx.info(`[Clarify] 创建追问，UUID: ${uuid}, 问题: ${input.question}`);
        if (input.options) {
            cctx.ctx.info(`[Clarify] 提供选项: ${input.options.join(' | ')}`);
        }

        let resolveFunc: (value: ClarifyOutput) => void;
        let rejectFunc: (reason?: string) => void;
        const promise = new Promise<ClarifyOutput>((resolve, reject) => {
            resolveFunc = resolve;
            rejectFunc = reject;
        });
        this.pendingClarifications.set(uuid, { resolve: resolveFunc!, reject: rejectFunc! });

        // 通知外部系统，携带问题、UUID 以及可选的选项
        try {
            const payload: { question: string; uuid: string; options?: string[] } = {
                question: input.question,
                uuid,
            };
            if (input.options) {
                payload.options = input.options;
            }
            cctx.ctx.prj.notify("clarify", payload);
            // cctx.ctx.notify("clarify", JSON.stringify(payload));
            cctx.ctx.info(`[Clarify] 已通知外部，等待 UUID ${uuid} 的回复`);
        } catch (error) {
            this.pendingClarifications.delete(uuid);
            cctx.ctx.error(`[Clarify] 通知失败: ${error}`);
            return defaultResponse;
        }

        const result = await pTimeout(promise, {
            milliseconds: 60 * 60 * 1000,
            fallback: () => {
                if (this.pendingClarifications.has(uuid)) {
                    this.pendingClarifications.delete(uuid);
                    cctx.ctx.info(`[Clarify] UUID ${uuid} 超时，返回默认值`);
                }
                return defaultResponse;
            },
        });

        return result;
    }

    resolveClarification(uuid: string, answer: string): boolean {
        const entry = this.pendingClarifications.get(uuid);
        if (entry) {
            this.pendingClarifications.delete(uuid);
            entry.resolve({ user_response: answer });
            Logger.debug(`[Clarify] UUID ${uuid} 已解析，回答: ${answer}`);
            return true;
        }
        Logger.debug(`[Clarify] UUID ${uuid} 未找到或已处理，无法解析`);
        return false;
    }

    rejectClarification(uuid: string, reason?: string): boolean {
        const entry = this.pendingClarifications.get(uuid);
        if (entry) {
            this.pendingClarifications.delete(uuid);
            entry.reject(reason || "用户取消追问");
            Logger.debug(`[Clarify] UUID ${uuid} 已拒绝，原因: ${reason || "用户取消追问"}`);
            return true;
        }
        Logger.debug(`[Clarify] UUID ${uuid} 未找到或已处理，无法拒绝`);
        return false;
    }
}

// ---------- 导出单例 ----------
const KEY = Symbol.for('unigen.singleton.UserClarifyTool');
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const userClarifyTool: UserClarifyTool = ((globalThis as any)[KEY] ??= new UserClarifyTool());