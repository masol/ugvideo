import { PuppeteerAgent } from './PuppeteerAgent.js';

const KEY = Symbol.for('unigen.singleton.puppeteerAgent');
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const puppeteerInst: PuppeteerAgent = ((globalThis as any)[KEY] ??= new PuppeteerAgent());