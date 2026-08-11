/**
 * weaver · Decision KB Storage
 */

import type { Skill } from '../types.js';
import { BaseStorage } from './base.js';

export class DecisionStorage extends BaseStorage {
    protected NS = '#weave:dec:';

    saveTool(toolId: string, tool: { name: string; description: string; keywords: string[] }): void {
        this.write(`tool:${toolId}`, tool);
        this.appendToIndex('idx:tools', toolId);
    }

    getTool(toolId: string): { name: string; description: string; keywords: string[] } | null {
        return this.read<{ name: string; description: string; keywords: string[] }>(`tool:${toolId}`);
    }

    listToolIds(): string[] {
        return this.read<string[]>('idx:tools') ?? [];
    }

    saveSkill(skill: Skill): void {
        this.write(`skill:${skill.id}`, skill);
        this.appendToIndex('idx:skills', skill.id);
    }

    getSkill(id: string): Skill | null {
        return this.read<Skill>(`skill:${id}`);
    }

    listSkillIds(): string[] {
        return this.read<string[]>('idx:skills') ?? [];
    }

    private appendToIndex(idxKey: string, id: string): void {
        const list = this.read<string[]>(idxKey) ?? [];
        if (!list.includes(id)) {
            this.write(idxKey, [...list, id]);
        }
    }
}