// command/center.ts

import { builtins } from "./buildin";
import type { CommandDescriptor, CommandHandler } from "./type";

interface CommandFilter {
    keyword?: string;
    category?: string;
}

interface CommandExecutionResult {
    success: boolean;
    commandId: string;
    result?: void;
    error?: Error;
}

class CommandItem {
    readonly id: string;
    label: string;
    category: string;
    description: string;
    handler: CommandHandler;

    constructor(options: CommandDescriptor) {
        this.id = options.id;
        this.label = options.label;
        this.category = options.category ?? '';
        this.description = options.description ?? '';
        this.handler = options.handler;
    }

    toDescriptor(): Omit<CommandDescriptor, 'handler'> {
        return {
            id: this.id,
            label: this.label,
            category: this.category,
            description: this.description,
        };
    }
}

class CommandCenter {
    private commands: Map<string, CommandItem> = new Map();

    constructor() {
        this.registerBuiltinCommands();
    }

    private registerBuiltinCommands(): void {


        this.registerBatch(builtins);
    }

    // ── 注册 ──

    register(options: CommandDescriptor, force = false): this {
        if (!options.id || !options.handler) {
            throw new Error(`[CommandCenter] 'id' and 'handler' are required.`);
        }
        if (this.commands.has(options.id) && !force) {
            throw new Error(
                `[CommandCenter] Command "${options.id}" already exists. Use force=true to overwrite.`
            );
        }
        this.commands.set(options.id, new CommandItem(options));
        return this;
    }

    registerBatch(batch: CommandDescriptor[], force = false): this {
        for (const opt of batch) {
            this.register(opt, force);
        }
        return this;
    }

    // ── 注销 ──

    unregister(id: string): boolean {
        return this.commands.delete(id);
    }

    unregisterByCategory(category: string): number {
        let count = 0;
        for (const [id, cmd] of this.commands) {
            if (cmd.category === category) {
                this.commands.delete(id);
                count++;
            }
        }
        return count;
    }

    clear(): void {
        this.commands.clear();
    }

    // ── 查询 ──

    has(id: string): boolean {
        return this.commands.has(id);
    }

    get(id: string) {
        return this.commands.get(id)?.toDescriptor() ?? null;
    }

    getAllDescriptors() {
        return [...this.commands.values()].map((c) => c.toDescriptor());
    }

    getCategories(): string[] {
        const cats = new Set<string>();
        for (const cmd of this.commands.values()) {
            if (cmd.category) cats.add(cmd.category);
        }
        return [...cats].sort();
    }

    search(filter: CommandFilter = {}) {
        const { keyword, category } = filter;
        const lower = keyword?.toLowerCase() ?? '';

        return [...this.commands.values()]
            .filter((cmd) => {
                if (category && cmd.category !== category) return false;
                if (lower) {
                    const haystack =
                        `${cmd.id} ${cmd.label} ${cmd.description} ${cmd.category}`.toLowerCase();
                    return haystack.includes(lower);
                }
                return true;
            })
            .map((c) => c.toDescriptor());
    }

    // ── 遍历 ──

    forEach(callback: (descriptor: Omit<CommandDescriptor, 'handler'>, id: string) => void): void {
        for (const [id, cmd] of this.commands) {
            callback(cmd.toDescriptor(), id);
        }
    }

    groupByCategory() {
        const groups: Record<string, Omit<CommandDescriptor, 'handler'>[]> = {};
        for (const cmd of this.commands.values()) {
            const cat = cmd.category || '(Uncategorized)';
            if (!groups[cat]) groups[cat] = [];
            groups[cat].push(cmd.toDescriptor());
        }
        return groups;
    }

    *[Symbol.iterator]() {
        for (const cmd of this.commands.values()) {
            yield cmd.toDescriptor();
        }
    }

    // ── 修改 ──

    update(id: string, patch: Partial<Pick<CommandDescriptor, 'label' | 'category' | 'description'>>): boolean {
        const cmd = this.commands.get(id);
        if (!cmd) return false;
        if (patch.label !== undefined) cmd.label = patch.label;
        if (patch.category !== undefined) cmd.category = patch.category;
        if (patch.description !== undefined) cmd.description = patch.description;
        return true;
    }

    replaceHandler(id: string, handler: CommandHandler): boolean {
        const cmd = this.commands.get(id);
        if (!cmd) return false;
        cmd.handler = handler;
        return true;
    }

    // ── 执行 ──

    async execute(id: string): Promise<CommandExecutionResult> {
        const cmd = this.commands.get(id);
        if (!cmd) {
            return { success: false, commandId: id, error: new Error(`Command "${id}" not found.`) };
        }
        try {
            const result = await cmd.handler();
            return { success: true, commandId: id, result };
        } catch (e) {
            return {
                success: false,
                commandId: id,
                error: e instanceof Error ? e : new Error(String(e)),
            };
        }
    }

    // ── 调试 ──

    dump(): void {
        console.group(`[CommandCenter] ${this.commands.size} commands`);
        const grouped = this.groupByCategory();
        for (const [cat, cmds] of Object.entries(grouped)) {
            console.groupCollapsed(`📁 ${cat} (${cmds.length})`);
            console.table(cmds.map((c) => ({ id: c.id, label: c.label, description: c.description })));
            console.groupEnd();
        }
        console.groupEnd();
    }

    exportJSON(): string {
        return JSON.stringify(this.getAllDescriptors(), null, 2);
    }
}

const KEY = Symbol.for('unigen.renderer.commandCenter');
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const commandCenter: CommandCenter = ((globalThis as any)[KEY] ??= new CommandCenter());