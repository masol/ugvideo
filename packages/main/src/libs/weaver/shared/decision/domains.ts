/**
 * weaver · 决策域登记
 *
 * 注册所有决策域（domain）的元信息。
 * 当前为占位——真正的决策函数实现留给各阶段文件。
 */

import type { DecisionDomain } from '../types.js';

export interface DomainMeta {
    domain: DecisionDomain;
    description: string;
    /** 默认 LLM 兜底模型标签 */
    fallbackModelTag: 'light' | 'standard' | 'heavy';
}

export const DOMAIN_REGISTRY: Record<DecisionDomain, DomainMeta> = {
    'parse': {
        domain: 'parse',
        description: '解析人写工作流文档为文本块',
        fallbackModelTag: 'light',
    },
    'split': {
        domain: 'split',
        description: '多动作拆解（1 节点 = 1 动作原子）',
        fallbackModelTag: 'light',
    },
    'identify-concepts': {
        domain: 'identify-concepts',
        description: '识别概念（artifact + action）+ 动作对齐 + 词汇归一',
        fallbackModelTag: 'standard',
    },
    'identify-constraints': {
        domain: 'identify-constraints',
        description: '从文档抄约束 + 标外部输入',
        fallbackModelTag: 'standard',
    },
    'formalize': {
        domain: 'formalize',
        description: '构建图（graphology DirectedGraph）',
        fallbackModelTag: 'light',
    },
    'extract-io': {
        domain: 'extract-io',
        description: '顺拓扑序逐节点提 IO',
        fallbackModelTag: 'light',
    },
    'cross-review': {
        domain: 'cross-review',
        description: '概念层多视角互相评审',
        fallbackModelTag: 'standard',
    },
    'concept-dedup': {
        domain: 'concept-dedup',
        description: '概念归一（细分子域）',
        fallbackModelTag: 'light',
    },
    'tool-match': {
        domain: 'tool-match',
        description: '工具匹配',
        fallbackModelTag: 'light',
    },
    'align-actions': {
        domain: 'align-actions',
        description: '动作对齐（细分子域）',
        fallbackModelTag: 'light',
    },
    'dataflow': {
        domain: 'dataflow',
        description: '形态感知 dataFlow（机器世界，本版本未用）',
        fallbackModelTag: 'light',
    },
    'parallel-continue': {
        domain: 'parallel-continue',
        description: '续接并行判定（本版本未用）',
        fallbackModelTag: 'light',
    },
    'skill-match': {
        domain: 'skill-match',
        description: 'Skill 匹配（下一篇文章）',
        fallbackModelTag: 'light',
    },
    'constraint-implicit': {
        domain: 'constraint-implicit',
        description: '全文蕴含约束扫描（预留扩展）',
        fallbackModelTag: 'heavy',
    },
};

export function getDomainMeta(domain: DecisionDomain): DomainMeta {
    return DOMAIN_REGISTRY[domain];
}