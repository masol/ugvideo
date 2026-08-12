/**
 * weaver · Decision KB Storage
 *
 * 注意：index 表（idx:tools / idx:skills）允许被覆盖——每次都是"完整的最新 id 集合"。
 * 数据项（tool:<id> / skill:<id>）也是"最新的覆盖旧的"语义。
 * 新鲜性由 checkExpiry 在节点入口统一维护。
 */

import type { Skill } from '../types.js';
import { BaseStorage } from './base.js';

export class DecisionStorage extends BaseStorage {
    protected NS = '#weave:dec:';

    saveTool(toolId: string, tool: { name: string; description: string; keywords: string[] }): void {
        this.set(`tool:${toolId}`, tool);
        this.appendToIndex('idx:tools', toolId);
    }

    getTool(toolId: string): { name: string; description: string; keywords: string[] } | null {
        return this.get<{ name: string; description: string; keywords: string[] }>(`tool:${toolId}`);
    }

    listToolIds(): string[] {
        return this.get<string[]>('idx:tools') ?? [];
    }

    saveSkill(skill: Skill): void {
        this.set(`skill:${skill.id}`, skill);
        this.appendToIndex('idx:skills', skill.id);
    }

    getSkill(id: string): Skill | null {
        return this.get<Skill>(`skill:${id}`);
    }

    listSkillIds(): string[] {
        return this.get<string[]>('idx:skills') ?? [];
    }

    private appendToIndex(idxKey: string, id: string): void {
        const list = this.get<string[]>(idxKey) ?? [];
        if (!list.includes(id)) {
            this.set(idxKey, [...list, id]);
        }
    }
}