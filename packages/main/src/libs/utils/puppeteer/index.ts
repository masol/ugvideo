import { BrowserWindow } from 'electron';
import { PuppeteerAgent } from './PuppeteerAgent.js';

export { AgentPage, type PageHost } from './AgentPage.js';
export type * from './types.js';

const KEY = Symbol.for('unigen.singleton.puppeteerAgent');
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const puppeteerInst: PuppeteerAgent = ((globalThis as any)[KEY] ??= new PuppeteerAgent());

/**
 * 判断窗口是否为 agent 工具窗口。转发到唯一单例，
 * 状态由 Symbol 保护，不受模块重复求值影响。
 */
export function isAgentWindow(win: BrowserWindow): boolean {
    return puppeteerInst.isAgentWindow(win);
}